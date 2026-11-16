<?php
declare(strict_types=1);

namespace TF;

final class Strava
{
    private const OAUTH = 'https://www.strava.com/oauth/';
    private const ACTIVITIES = 'https://www.strava.com/api/v3/activities';
    private const UPLOADS = 'https://www.strava.com/api/v3/uploads';
    private array $config;
    private \Closure $http;

    public function __construct(private Db $db, array $config, ?\Closure $http = null)
    {
        $this->config = $config['strava'] ?? [];
        $this->http = $http ?? self::request(...);
    }

    public function enabled(): bool
    {
        $url = $this->config['callback_url'] ?? '';
        return !empty($this->config['client_id']) && !empty($this->config['client_secret'])
            && filter_var($url, FILTER_VALIDATE_URL) && parse_url($url, PHP_URL_SCHEME) === 'https';
    }

    public function connection(int $uid): array
    {
        $enabled = $this->enabled();
        return [
            'enabled' => $enabled,
            'connected' => $enabled && $this->db->val('SELECT user_id FROM strava_connections WHERE user_id=?', [$uid]) !== null,
        ];
    }

    private function requireConfig(): void
    {
        if (!$this->enabled()) {
            throw new HttpError(503, 'Strava is not configured on this server.');
        }
    }

    public function authorize(string $sessionHash): string
    {
        $this->requireConfig();
        $state = bin2hex(random_bytes(32));
        $this->db->run('DELETE FROM strava_oauth_states WHERE expires_at<=?', [now_utc()]);
        $this->db->insert('strava_oauth_states', [
            'nonce_hash' => hash('sha256', $state),
            'session_hash' => $sessionHash,
            'expires_at' => now_utc(time() + 600),
        ]);
        return self::OAUTH . 'authorize?' . http_build_query([
            'client_id' => $this->config['client_id'],
            'redirect_uri' => $this->config['callback_url'],
            'response_type' => 'code',
            'scope' => 'activity:write',
            'state' => $state,
        ], '', '&', PHP_QUERY_RFC3986);
    }

    public function connect(int $uid, string $sessionHash, array $query): void
    {
        $this->requireConfig();
        $state = $query['state'] ?? null;
        if (!is_string($state) || !preg_match('/^[a-f0-9]{64}$/D', $state)
            || $this->db->run('DELETE FROM strava_oauth_states WHERE nonce_hash=? AND session_hash=? AND expires_at>?',
                [hash('sha256', $state), $sessionHash, now_utc()])->rowCount() !== 1) {
            throw new HttpError(400, 'Start the Strava connection again from Settings.');
        }
        $code = $query['code'] ?? null;
        $scopes = preg_split('/[\s,]+/', is_string($query['scope'] ?? null) ? $query['scope'] : '');
        if (!is_string($code) || $code === '' || !in_array('activity:write', $scopes, true)) {
            throw new HttpError(403, 'Allow Strava activity access to send workouts.');
        }
        $tokens = $this->tokens(['grant_type' => 'authorization_code', 'code' => $code]);
        $sql = $this->db->driver === 'mysql'
            ? 'ON DUPLICATE KEY UPDATE tokens=?, expires_at=?'
            : 'ON CONFLICT(user_id) DO UPDATE SET tokens=?, expires_at=?';
        $this->db->run("INSERT INTO strava_connections (user_id, tokens, expires_at) VALUES (?, ?, ?) $sql",
            [$uid, $tokens['tokens'], $tokens['expires_at'], $tokens['tokens'], $tokens['expires_at']]);
    }

    public function disconnect(int $uid): array
    {
        $this->db->run('DELETE FROM strava_connections WHERE user_id=?', [$uid]);
        return $this->connection($uid);
    }

    private function tokens(array $grant): array
    {
        [$status, $data] = ($this->http)(self::OAUTH . 'token', $grant + [
            'client_id' => $this->config['client_id'],
            'client_secret' => $this->config['client_secret'],
        ], null);
        if ($status === 400 || $status === 401 || $status === 403) {
            throw new HttpError(409, 'Strava rejected the connection. Try connecting again in Settings.');
        }
        if ($status !== 200 || empty($data['access_token']) || empty($data['refresh_token'])
            || !is_numeric($data['expires_at'] ?? null)) {
            throw new HttpError(502, 'Could not connect to Strava. Try again in Settings.');
        }
        $iv = random_bytes(12);
        $plain = json_encode(['access' => $data['access_token'], 'refresh' => $data['refresh_token']], JSON_THROW_ON_ERROR);
        $box = openssl_encrypt($plain, 'aes-256-gcm', $this->key(), OPENSSL_RAW_DATA, $iv, $tag);
        if ($box === false) {
            throw new \RuntimeException('Could not encrypt Strava credentials.');
        }
        return ['tokens' => base64_encode($iv . $tag . $box), 'expires_at' => (int) $data['expires_at']];
    }

    private function key(): string
    {
        return hash_hkdf('sha256', $this->config['client_secret'], 32, 'ThoeneFit Strava tokens');
    }

    private function decrypt(string $tokens): array
    {
        $box = base64_decode($tokens, true);
        $plain = $box !== false && strlen($box) > 28
            ? openssl_decrypt(substr($box, 28), 'aes-256-gcm', $this->key(), OPENSSL_RAW_DATA, substr($box, 0, 12), substr($box, 12, 16))
            : false;
        if ($plain === false) {
            throw new HttpError(409, 'Reconnect to Strava in Settings.');
        }
        return json_decode($plain, true, 512, JSON_THROW_ON_ERROR);
    }

    private function accessToken(int $uid): string
    {
        $row = $this->db->one('SELECT * FROM strava_connections WHERE user_id=?', [$uid]);
        if (!$row) {
            throw new HttpError(409, 'Connect to Strava in Settings first.');
        }
        if ((int) $row['expires_at'] > time() + 60) {
            return $this->decrypt($row['tokens'])['access'];
        }
        return $this->db->tx(function (Db $db) use ($uid): string {
            // Serialize refreshes so two concurrent exports cannot race a rotated token.
            $db->run('UPDATE strava_connections SET expires_at=expires_at WHERE user_id=?', [$uid]);
            $row = $db->one('SELECT * FROM strava_connections WHERE user_id=?', [$uid]);
            if (!$row) {
                throw new HttpError(409, 'Connect to Strava in Settings first.');
            }
            $tokens = $this->decrypt($row['tokens']);
            if ((int) $row['expires_at'] > time() + 60) {
                return $tokens['access'];
            }
            $row = $this->tokens(['grant_type' => 'refresh_token', 'refresh_token' => $tokens['refresh']]);
            $db->update('strava_connections', $row, 'user_id=?', [$uid]);
            return $this->decrypt($row['tokens'])['access'];
        });
    }

    public function exportStatus(int $uid, string $id): ?array
    {
        return self::receipt($this->exportRow($uid, strtolower($id)));
    }

    private function exportRow(int $uid, string $id): ?array
    {
        return $this->db->one('SELECT activity_id, upload_id, poll_after FROM strava_exports WHERE user_id=? AND workout_id=?', [$uid, $id]);
    }

    private static function receipt(?array $row): ?array
    {
        if ($row === null) {
            return null;
        }
        $receipt = ['activity_id' => $row['activity_id']];
        if ($row['activity_id'] === null && $row['upload_id'] !== null) {
            $receipt['processing'] = true;
        }
        return $receipt;
    }

    /**
     * Sends a workout that was just finished with "Send to Strava" ticked (#87).
     * $request is the strava_send the app stored on the workout:
     * {include_summary: bool, utc_offset: int}. It runs once, on the save that
     * finished the workout, and never throws: the workout is already saved, and a
     * failed send can be retried from the workout's page in History.
     * Returns the export receipt, or null when nothing was sent.
     */
    public function sendOnFinish(int $uid, string $id, mixed $request, bool $completedNow): ?array
    {
        if (!$completedNow || !is_array($request) || !$this->connection($uid)['connected']) {
            return null;
        }
        $offset = $request['utc_offset'] ?? 0;
        try {
            return $this->export($uid, $id, ($request['include_summary'] ?? false) === true, is_int($offset) ? $offset : 0, ($request['include_calories'] ?? false) === true);
        } catch (\Throwable $e) {
            error_log('ThoeneFit: sending workout ' . $id . ' to Strava on finish failed: ' . $e->getMessage());
            return null;
        }
    }

    public function export(int $uid, string $id, bool $summary, int $utcOffset = 0, bool $calories = false): array
    {
        $workout = (new Workouts($this->db))->get($uid, $id);
        if (!$workout || $workout['status'] !== 'completed') {
            throw new HttpError(404, 'Completed workout not found.');
        }
        $id = $workout['id'];
        $existing = $this->exportStatus($uid, $id);
        if ($existing !== null) {
            return $existing;
        }
        $this->requireConfig();
        $activity = self::activity($workout);
        $details = $summary ? StravaStrength::details($workout) : ['sets' => [], 'description' => ''];
        // Estimated calories (#38). Strava does not work out calories for weight
        // training itself. Its strength file has a total_calories field, but that
        // file needs at least one set; without one, the estimate goes in the description.
        $kcal = null;
        if ($calories) {
            $kg = $this->db->val('SELECT body_weight_kg FROM users WHERE id=?', [$uid]);
            $kcal = Calories::estimate($workout, $kg === null ? null : (float) $kg);
        }
        if ($kcal !== null && !$details['sets']) {
            $details['description'] = trim($details['description'] . "\nEstimated calories: $kcal");
        }
        if ($details['description'] !== '') {
            $activity['description'] = $details['description'];
        }
        $file = null;
        if ($details['sets']) {
            $file = json_encode([
                'version' => '1.0',
                'start_time' => $activity['start_date_local'],
                'utc_offset' => abs($utcOffset) <= 14 * 3600 && $utcOffset % 60 === 0 ? $utcOffset : 0,
                'elapsed_time' => $activity['elapsed_time'],
            ] + ($kcal !== null ? ['total_calories' => $kcal] : []) + [
                'sets' => $details['sets'],
            ], JSON_THROW_ON_ERROR);
        }
        $token = $this->accessToken($uid);
        try {
            $this->db->insert('strava_exports', ['user_id' => $uid, 'workout_id' => $id]);
        } catch (\PDOException $e) {
            if ((string) $e->getCode() !== '23000' || ($existing = $this->exportStatus($uid, $id)) === null) {
                throw $e;
            }
            return $existing;
        }

        if ($file !== null) {
            $form = array_intersect_key($activity, array_flip(['name', 'description', 'sport_type'])) + [
                'data_type' => 'json',
                'external_id' => 'thoenefit-' . $id,
            ];
            [$status, $data] = ($this->http)(self::UPLOADS, $form, $token, $file);
            if ($status === 201) {
                $activityId = self::stravaId($data['activity_id'] ?? null);
                if ($activityId !== null) {
                    return $this->recordActivity($uid, $id, $activityId);
                }
                $uploadId = self::stravaId($data['id_str'] ?? $data['id'] ?? null);
                if ($uploadId !== null) {
                    $this->db->update('strava_exports', ['upload_id' => $uploadId, 'poll_after' => time() + 2], 'user_id=? AND workout_id=?', [$uid, $id]);
                    return ['activity_id' => null, 'processing' => true];
                }
            }
        } else {
            [$status, $data] = ($this->http)(self::ACTIVITIES, $activity, $token);
            $activityId = self::stravaId($data['id'] ?? null);
            if ($status === 201 && $activityId !== null) {
                return $this->recordActivity($uid, $id, $activityId);
            }
        }
        // Only release the reservation when Strava explicitly rejected the request.
        // A timeout, invalid response or upstream failure can happen after creation.
        if (in_array($status, [400, 401, 403, 404, 415, 422, 429], true) && is_array($data)
            && stripos(json_encode($data, JSON_INVALID_UTF8_SUBSTITUTE), 'duplicate') === false) {
            $this->db->run('DELETE FROM strava_exports WHERE user_id=? AND workout_id=?', [$uid, $id]);
            $message = match ($status) {
                401, 403 => 'Reconnect to Strava in Settings, then try again.',
                429 => 'Strava is rate limiting requests. Wait a little and try again.',
                default => 'Strava rejected this workout. No activity was created.',
            };
            throw new HttpError(409, $message);
        }
        return ['activity_id' => null];
    }

    public function checkExport(int $uid, string $id): ?array
    {
        if (!is_uuid($id)) {
            throw new HttpError(422, 'Workout id is malformed.');
        }
        $id = strtolower($id);
        $row = $this->exportRow($uid, $id);
        if (!$row || $row['upload_id'] === null || (int) $row['poll_after'] > time()) {
            return self::receipt($row);
        }
        $this->requireConfig();
        $token = $this->accessToken($uid);
        $now = time();
        $lease = $now + 15; // Hold the check long enough for the HTTP request to return.
        $uploadId = $row['upload_id'];
        $claimed = $this->db->run('UPDATE strava_exports SET poll_after=? WHERE user_id=? AND workout_id=? AND upload_id=? AND poll_after<=?',
            [$lease, $uid, $id, $uploadId, $now])->rowCount();
        if (!$claimed) {
            return $this->exportStatus($uid, $id);
        }

        [$status, $data] = ($this->http)(self::UPLOADS . '/' . $uploadId, null, $token);
        if ($status === 401 || $status === 403) {
            throw new HttpError(409, 'Reconnect to Strava in Settings, then check again.');
        }
        if ($status !== 200 || !is_array($data)) {
            return $this->exportStatus($uid, $id);
        }
        $where = 'user_id=? AND workout_id=? AND upload_id=? AND poll_after=?';
        $claim = [$uid, $id, $uploadId, $lease];
        $activityId = self::stravaId($data['activity_id'] ?? null);
        $error = is_string($data['error'] ?? null) ? $data['error'] : '';
        $message = is_string($data['status'] ?? null) ? $data['status'] : '';
        if ($activityId !== null || stripos($error, 'duplicate') !== false || stripos($message, 'deleted') !== false) {
            $this->db->update('strava_exports', ['activity_id' => $activityId, 'upload_id' => null], $where, $claim);
        } elseif ($error !== '') {
            // Processing failed without creating an activity. Allow a fresh attempt.
            $this->db->run("DELETE FROM strava_exports WHERE $where", $claim);
        } else {
            $this->db->update('strava_exports', ['poll_after' => time() + 2], $where, $claim);
        }
        return $this->exportStatus($uid, $id);
    }

    private static function stravaId($value): ?string
    {
        return (is_int($value) || is_string($value)) && preg_match('/^[1-9][0-9]{0,23}$/D', (string) $value)
            ? (string) $value
            : null;
    }

    private function recordActivity(int $uid, string $id, string $activityId): array
    {
        $this->db->update('strava_exports', ['activity_id' => $activityId, 'upload_id' => null], 'user_id=? AND workout_id=?', [$uid, $id]);
        return ['activity_id' => $activityId];
    }

    private static function activity(array $workout): array
    {
        // Idle time before the first set or after the last is left out, so a
        // workout left open overnight is not sent as a 14-hour activity (#49).
        $span = Workouts::workoutSpan($workout);
        if ($span === null) {
            throw new HttpError(422, 'This workout has no recorded duration to send to Strava.');
        }
        $label = Generator::DAY_LABELS[$workout['day_type']] ?? 'Workout';
        return [
            'name' => $label . ' at ' . $workout['gym_name'],
            'sport_type' => 'WeightTraining',
            'start_date_local' => gmdate('Y-m-d\TH:i:s\Z', $span['start']),
            'elapsed_time' => $span['seconds'],
        ];
    }

    private static function request(string $url, ?array $form, ?string $token, ?string $file = null): array
    {
        $headers = ['Accept: application/json'];
        if ($token !== null) {
            $headers[] = 'Authorization: Bearer ' . $token;
        }
        $options = [
            'method' => $form === null ? 'GET' : 'POST',
            'ignore_errors' => true,
            'follow_location' => 0,
            'timeout' => 8,
        ];
        if ($file !== null) {
            $boundary = bin2hex(random_bytes(18));
            $headers[] = 'Content-Type: multipart/form-data; boundary=' . $boundary;
            $content = '';
            foreach ($form as $key => $value) {
                $content .= "--$boundary\r\nContent-Disposition: form-data; name=\"$key\"\r\n\r\n$value\r\n";
            }
            $content .= "--$boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"workout.json\"\r\n";
            $options['content'] = $content . "Content-Type: application/json\r\n\r\n$file\r\n--$boundary--\r\n";
        } elseif ($form !== null) {
            $headers[] = 'Content-Type: application/x-www-form-urlencoded';
            $options['content'] = http_build_query($form, '', '&', PHP_QUERY_RFC3986);
        }
        $context = stream_context_create(['http' => $options + ['header' => $headers]]);
        $body = @file_get_contents($url, false, $context);
        preg_match('/^HTTP\/\S+ (\d{3})/', $http_response_header[0] ?? '', $match);
        return [(int) ($match[1] ?? 0), $body === false ? null : json_decode($body, true, 512, JSON_BIGINT_AS_STRING)];
    }
}
