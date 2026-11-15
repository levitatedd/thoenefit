<?php
declare(strict_types=1);

namespace TF;

/** JSON API behind web/api.php. Every call is /api.php?a=<action>. */
final class Api
{
    private App $app;
    private Db $db;
    private Auth $auth;
    private Workouts $workouts;
    private Generator $gen;
    private Shares $shares;
    private Strava $strava;

    public static function handle(): void
    {
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: same-origin');
        try {
            $api = new Api(App::boot());
            $api->route();
        } catch (HttpError $e) {
            self::json(['error' => $e->getMessage()], $e->status);
        } catch (\Throwable $e) {
            error_log('ThoeneFit: ' . $e->getMessage() . ' at ' . $e->getFile() . ':' . $e->getLine());
            $msg = PHP_SAPI === 'cli-server' ? $e->getMessage() : 'Something went wrong on the server. Check the PHP error log.';
            self::json(['error' => $msg], 500);
        }
    }

    public function __construct(App $app)
    {
        $this->app = $app;
        $this->db = $app->db;
        $this->auth = new Auth($app->db, $app->config);
        $this->workouts = new Workouts($app->db);
        $this->gen = new Generator($app->db);
        $this->shares = new Shares($app->db);
        $this->strava = new Strava($app->db, $app->config);
    }

    private static function json($data, int $status = 200): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }

    private function route(): void
    {
        $action = (string) ($_GET['a'] ?? '');
        $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
        $in = [];
        if ($method === 'POST') {
            if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) {
                throw new HttpError(415, 'Send JSON.');
            }
            $in = json_decode(file_get_contents('php://input') ?: '{}', true);
            if (!is_array($in)) {
                throw new HttpError(400, 'Request body is not valid JSON.');
            }
        }

        if ($action === 'login' && $method === 'POST') {
            $this->auth->login((string) ($in['username'] ?? ''), (string) ($in['password'] ?? ''));
            self::json(['ok' => true]);
            return;
        }

        if ($action === 'request_account' && $method === 'POST') {
            // Open to people who are not signed in, but only with the admin's invite token.
            $this->auth->requestAccount((string) ($in['token'] ?? ''), (string) ($in['username'] ?? ''), (string) ($in['password'] ?? ''), trim((string) ($in['display_name'] ?? '')));
            self::json(['ok' => true]);
            return;
        }

        $user = $this->auth->user();
        if ($action === 'strava_callback' && $method === 'GET') {
            $result = 'strava-error';
            if ($user) {
                try {
                    $this->strava->connect((int) $user['id'], $this->auth->session['token_hash'], $_GET);
                    $result = 'strava-connected';
                } catch (HttpError $e) {
                    if ($e->status === 403) {
                        $result = 'strava-denied';
                    }
                }
            }
            header('Location: ./#/settings/' . $result, true, 303);
            return;
        }
        if ($action === 'bootstrap' && $method === 'GET') {
            self::json($user ? $this->bootstrap($user) : ['user' => null, 'version' => APP_VERSION]);
            return;
        }
        if (!$user) {
            throw new HttpError(401, 'Sign in to continue.');
        }
        $uid = (int) $user['id'];

        $get = [
            'history' => fn() => ['workouts' => $this->workouts->history($uid, (int) ($_GET['limit'] ?? 30), (int) ($_GET['offset'] ?? 0))],
            'workout' => function () use ($uid) {
                $w = $this->workouts->get($uid, (string) ($_GET['id'] ?? ''));
                if (!$w) {
                    throw new HttpError(404, 'Workout not found.');
                }
                return [
                    'workout' => $w,
                    'strava' => $this->strava->connection($uid),
                    'strava_export' => $this->strava->exportStatus($uid, $w['id']),
                ];
            },
            'exercise_history' => fn() => ['sessions' => $this->workouts->exerciseHistory($uid, (int) ($_GET['id'] ?? 0))],
            'recovery' => fn() => ['recovery' => $this->gen->muscleStats($uid)],
            // Other people on this server, by display name only, for sharing a workout.
            'people' => fn() => ['people' => $this->people($uid)],
            'shares' => fn() => [
                'incoming' => $this->shares->incoming($uid),
                'outgoing' => $this->shares->outgoing($uid, (string) ($_GET['key'] ?? '')),
            ],
            'users' => function () use ($user) {
                Auth::requireAdmin($user);
                return $this->accounts();
            },
        ];
        if ($method === 'GET' && $action === 'export') {
            header('Content-Type: text/csv; charset=utf-8');
            header('Content-Disposition: attachment; filename="thoenefit-' . gmdate('Y-m-d') . '.csv"');
            $out = fopen('php://output', 'w');
            $this->workouts->exportCsv($uid, $out);
            fclose($out);
            return;
        }
        if ($method === 'GET' && isset($get[$action])) {
            self::json($get[$action]());
            return;
        }

        if ($method !== 'POST') {
            throw new HttpError(404, 'Unknown action.');
        }
        $this->auth->checkCsrf();
        switch ($action) {
            case 'strava_authorize':
                self::json(['url' => $this->strava->authorize($this->auth->session['token_hash'])]);
                return;
            case 'strava_disconnect':
                self::json(['strava' => $this->strava->disconnect($uid)]);
                return;
            case 'strava_export':
                self::json($this->strava->export($uid, (string) ($in['id'] ?? ''), ($in['include_summary'] ?? false) === true));
                return;
            case 'logout':
                $this->auth->logout();
                self::json(['ok' => true]);
                return;
            case 'create_user':
                Auth::requireAdmin($user);
                $this->auth->createUser((string) ($in['username'] ?? ''), (string) ($in['password'] ?? ''), trim((string) ($in['display_name'] ?? '')));
                self::json($this->accounts());
                return;
            case 'set_invite_token':
                Auth::requireAdmin($user);
                $this->auth->setInviteToken((string) ($in['token'] ?? ''));
                self::json($this->accounts());
                return;
            case 'approve_request':
                Auth::requireAdmin($user);
                $this->auth->approveRequest((int) ($in['id'] ?? 0));
                self::json($this->accounts());
                return;
            case 'decline_request':
                Auth::requireAdmin($user);
                $this->auth->declineRequest((int) ($in['id'] ?? 0));
                self::json($this->accounts());
                return;
            case 'change_password':
                if (!password_verify((string) ($in['current'] ?? ''), $user['password_hash'])) {
                    throw new HttpError(403, 'Current password is wrong.');
                }
                $this->auth->setPassword($uid, (string) ($in['next'] ?? ''));
                self::json(['ok' => true]);
                return;
            case 'save_profile':
                self::json(['user' => $this->saveProfile($user, $in)]);
                return;
            case 'save_gym':
                self::json(['gym' => $this->saveGym($user, $in), 'gyms' => $this->gyms($uid)]);
                return;
            case 'delete_gym':
                $this->db->run('DELETE FROM gyms WHERE id=? AND user_id=?', [(int) ($in['id'] ?? 0), $uid]);
                $gyms = $this->gyms($uid);
                if ((int) $user['active_gym_id'] === (int) ($in['id'] ?? 0)) {
                    $this->db->run('UPDATE users SET active_gym_id=? WHERE id=?', [$gyms[0]['id'] ?? null, $uid]);
                }
                self::json(['gyms' => $gyms, 'user' => self::userShape($this->db->one('SELECT * FROM users WHERE id=?', [$uid]))]);
                return;
            case 'save_exercise':
                self::json(['exercise' => $this->saveExercise($user, $in)]);
                return;
            case 'archive_exercise':
                $row = $this->db->one('SELECT * FROM exercises WHERE id=?', [(int) ($in['id'] ?? 0)]);
                if (!$row || !Catalog::canEdit($row, $user)) {
                    throw new HttpError(404, 'Only exercises you created can be archived.');
                }
                $this->db->run('UPDATE exercises SET archived=? WHERE id=?', [empty($in['archived']) ? 0 : 1, $row['id']]);
                self::json(['ok' => true]);
                return;
            case 'generate':
                $gym = $this->gym($uid, (int) ($in['gym_id'] ?? 0));
                self::json(['workout' => $this->gen->generate($user, $gym, $in)]);
                return;
            case 'alternatives':
                $gym = $this->gym($uid, (int) ($in['gym_id'] ?? 0));
                self::json(['alternatives' => $this->gen->alternatives($uid, $gym, (int) ($in['exercise_id'] ?? 0), (array) ($in['exclude'] ?? []))]);
                return;
            case 'suggest':
                $gym = $this->gym($uid, (int) ($in['gym_id'] ?? 0));
                $ex = null;
                foreach (Catalog::forUser($this->db, $uid, true) as $e) {
                    if ($e['id'] === (int) ($in['exercise_id'] ?? 0)) {
                        $ex = $e;
                    }
                }
                if (!$ex) {
                    throw new HttpError(404, 'Exercise not found.');
                }
                self::json(['block' => $this->gen->block($user, $gym, $ex)]);
                return;
            case 'import_fitbod':
                @set_time_limit(180);
                $gym = $this->gym($uid, (int) ($in['gym_id'] ?? 0));
                $imp = new FitbodImport($this->db);
                $parsed = FitbodImport::parse((string) ($in['csv'] ?? ''));
                if (!$parsed['workouts']) {
                    throw new HttpError(422, 'No sets with reps were found in that file.');
                }
                $plan = $imp->plan($uid, $parsed, (array) ($in['choices'] ?? []));
                $out = ['summary' => $imp->summary($parsed, $plan), 'exercises' => $plan];
                if (!empty($in['commit'])) {
                    $out['imported'] = $imp->run($uid, $gym, $user['unit'], $parsed, $plan);
                    $out['catalog'] = Catalog::forUser($this->db, $uid, true);
                }
                self::json($out);
                return;
            case 'remove_fitbod':
                self::json(['removed' => (new FitbodImport($this->db))->purge($uid)]);
                return;
            case 'save_workout':
                $doc = (array) ($in['workout'] ?? []);
                $saved = $this->workouts->save($uid, $doc);
                if (!empty($saved['ok'])) {
                    // A workout started from a shared plan closes that share; one started
                    // from a plan this person shared lets later accepts follow it.
                    if (!empty($doc['share_id'])) {
                        $this->shares->markStarted($uid, (int) $doc['share_id'], (string) $doc['id']);
                    }
                    if (!empty($doc['share_key'])) {
                        $this->shares->link($uid, (string) $doc['share_key'], (string) $doc['id']);
                    }
                }
                self::json($saved);
                return;
            case 'share_workout':
                $this->shares->send(
                    $uid,
                    (string) ($in['share_key'] ?? ''),
                    (array) ($in['to'] ?? []),
                    array_column($this->people($uid), 'id'),
                    (array) ($in['plan'] ?? []),
                    isset($in['workout_id']) ? (string) $in['workout_id'] : null
                );
                self::json(['outgoing' => $this->shares->outgoing($uid, (string) ($in['share_key'] ?? ''))]);
                return;
            case 'share_respond':
                if (!empty($in['accept'])) {
                    $this->shares->accept($uid, (int) ($in['id'] ?? 0));
                } else {
                    $this->shares->decline($uid, (int) ($in['id'] ?? 0));
                }
                self::json(['incoming' => $this->shares->incoming($uid)]);
                return;
            case 'shared_draft':
                $gym = $this->gym($uid, (int) ($in['gym_id'] ?? 0));
                self::json([
                    'workout' => $this->shares->draft($user, $gym, (int) ($in['id'] ?? 0), $this->gen),
                    // Accepting can add the sender's own exercises to this person's library.
                    'exercises' => Catalog::forUser($this->db, $uid, true),
                ]);
                return;
            case 'delete_workout':
                $this->workouts->delete($uid, (string) ($in['id'] ?? ''));
                self::json(['ok' => true]);
                return;
        }
        throw new HttpError(404, 'Unknown action.');
    }

    private static function userShape(array $u): array
    {
        return [
            'id' => (int) $u['id'],
            'username' => $u['username'],
            'display_name' => $u['display_name'],
            'role' => Auth::isAdmin($u) ? 'admin' : 'user',
            'unit' => $u['unit'],
            'goal' => $u['goal'],
            'experience' => $u['experience'],
            'minutes' => (int) $u['minutes'],
            'split_type' => $u['split_type'],
            'active_gym_id' => $u['active_gym_id'] === null ? null : (int) $u['active_gym_id'],
            'onboarded' => (int) $u['onboarded'] === 1,
        ];
    }

    /** Everyone else with a working account: id and display name only. */
    private function people(int $uid): array
    {
        $out = [];
        foreach ($this->auth->listUsers() as $u) {
            if ($u['id'] !== $uid) {
                $out[] = ['id' => $u['id'], 'name' => $u['display_name']];
            }
        }
        return $out;
    }

    private function gyms(int $uid): array
    {
        return array_map([Generator::class, 'gymShape'], $this->db->all('SELECT * FROM gyms WHERE user_id=? ORDER BY id', [$uid]));
    }

    private function gym(int $uid, int $id): array
    {
        $row = $this->db->one('SELECT * FROM gyms WHERE id=? AND user_id=?', [$id, $uid]);
        if (!$row) {
            throw new HttpError(404, 'Gym profile not found. Add one in Settings.');
        }
        return Generator::gymShape($row);
    }

    /** Everything the Manage Users page shows. Admin only; callers check that first. */
    private function accounts(): array
    {
        return [
            'users' => $this->auth->listUsers(),
            'requests' => $this->auth->pendingRequests(),
            'invite' => $this->auth->inviteStatus(),
        ];
    }

    private function bootstrap(array $user): array
    {
        $uid = (int) $user['id'];
        $active = $this->workouts->active($uid);
        if ($active) {
            foreach ($active['exercises'] as &$e) {
                $e['previous'] = $this->gen->lastPerformance($uid, $e['variant_key']);
            }
            unset($e);
        }
        return [
            'version' => APP_VERSION,
            'csrf' => $this->auth->session['csrf'],
            'user' => self::userShape($user),
            'pending_requests' => Auth::isAdmin($user) ? count($this->auth->pendingRequests()) : 0,
            'gyms' => $this->gyms($uid),
            'exercises' => Catalog::forUser($this->db, $uid, true),
            'active' => $active,
            'shares' => $this->shares->incoming($uid),
            'strava' => $this->strava->connection($uid),
            'vocab' => [
                'equipment' => Catalog::equipment(),
                'presets' => Catalog::presets(),
                'muscles' => Catalog::MUSCLES,
                'patterns' => Catalog::PATTERNS,
                'kinds' => Catalog::KINDS,
                'compound' => Catalog::COMPOUND,
                'day_labels' => Generator::DAY_LABELS,
                'split_days' => Generator::SPLIT_DAYS,
                'increments' => ['lb' => Catalog::defaultIncrements('lb'), 'kg' => Catalog::defaultIncrements('kg')],
            ],
        ];
    }

    private function saveProfile(array $user, array $in): array
    {
        $uid = (int) $user['id'];
        $set = [];
        if (isset($in['display_name'])) {
            $name = trim((string) $in['display_name']);
            if ($name !== '') {
                $set['display_name'] = mb_substr($name, 0, 100);
            }
        }
        if (isset($in['unit']) && in_array($in['unit'], ['lb', 'kg'], true)) {
            $set['unit'] = $in['unit'];
        }
        if (isset($in['goal']) && isset(Generator::GOALS[$in['goal']])) {
            $set['goal'] = $in['goal'];
        }
        if (isset($in['experience']) && isset(Generator::EXPERIENCE[$in['experience']])) {
            $set['experience'] = $in['experience'];
        }
        if (isset($in['split_type']) && isset(Generator::SPLIT_DAYS[$in['split_type']])) {
            $set['split_type'] = $in['split_type'];
        }
        if (isset($in['minutes'])) {
            $set['minutes'] = max(15, min(180, (int) $in['minutes']));
        }
        if (isset($in['active_gym_id'])) {
            $this->gym($uid, (int) $in['active_gym_id']);
            $set['active_gym_id'] = (int) $in['active_gym_id'];
        }
        if (isset($in['onboarded'])) {
            $set['onboarded'] = empty($in['onboarded']) ? 0 : 1;
        }
        if ($set) {
            $this->db->update('users', $set, 'id=?', [$uid]);
        }
        return self::userShape($this->db->one('SELECT * FROM users WHERE id=?', [$uid]));
    }

    private function saveGym(array $user, array $in): array
    {
        $uid = (int) $user['id'];
        $name = trim((string) ($in['name'] ?? ''));
        if ($name === '') {
            throw new HttpError(422, 'Give the gym a name.');
        }
        $valid = array_flip(Catalog::equipmentKeys());
        $equipment = [];
        foreach ((array) ($in['equipment'] ?? []) as $k) {
            if (is_string($k) && isset($valid[$k])) {
                $equipment[$k] = true;
            }
        }
        $increments = [];
        foreach ((array) ($in['increments'] ?? []) as $kind => $v) {
            if (isset(Catalog::KINDS[$kind]) && is_numeric($v) && (float) $v >= 0 && (float) $v <= 100) {
                $increments[$kind] = round((float) $v, 2);
            }
        }
        $row = [
            'name' => mb_substr($name, 0, 100),
            'equipment' => json_encode(array_keys($equipment)),
            'increments' => json_encode((object) $increments),
        ];
        $id = (int) ($in['id'] ?? 0);
        if ($id) {
            $this->gym($uid, $id);
            $this->db->update('gyms', $row, 'id=? AND user_id=?', [$id, $uid]);
        } else {
            if ((int) $this->db->val('SELECT COUNT(*) FROM gyms WHERE user_id=?', [$uid]) >= 20) {
                throw new HttpError(422, 'You can keep up to 20 gym profiles.');
            }
            $id = $this->db->insert('gyms', $row + ['user_id' => $uid, 'created_at' => now_utc()]);
            if (!$user['active_gym_id']) {
                $this->db->run('UPDATE users SET active_gym_id=? WHERE id=?', [$id, $uid]);
            }
        }
        return $this->gym($uid, $id);
    }

    private function saveExercise(array $user, array $in): array
    {
        $uid = (int) $user['id'];
        $name = trim((string) ($in['name'] ?? ''));
        if ($name === '') {
            throw new HttpError(422, 'Give the exercise a name.');
        }
        $kind = (string) ($in['kind'] ?? '');
        $pattern = (string) ($in['pattern'] ?? '');
        if (!isset(Catalog::KINDS[$kind]) || !isset(Catalog::PATTERNS[$pattern])) {
            throw new HttpError(422, 'Pick an equipment type and a movement.');
        }
        $validEq = array_flip(Catalog::equipmentKeys());
        $equipment = array_values(array_unique(array_filter((array) ($in['equipment'] ?? []), static fn($k) => is_string($k) && isset($validEq[$k]))));
        $muscle = static fn($list) => array_values(array_unique(array_filter((array) $list, static fn($m) => is_string($m) && isset(Catalog::MUSCLES[$m]))));
        $main = $muscle($in['muscles_main'] ?? []);
        if (!$main) {
            throw new HttpError(422, 'Pick at least one primary muscle.');
        }
        $row = [
            'name' => mb_substr($name, 0, 120),
            'kind' => $kind,
            'equipment' => json_encode($equipment),
            'pattern' => $pattern,
            'muscles_main' => json_encode($main),
            'muscles_assist' => json_encode(array_values(array_diff($muscle($in['muscles_assist'] ?? []), $main))),
            'cues' => mb_substr(trim((string) ($in['cues'] ?? '')), 0, 1000),
        ];
        $id = (int) ($in['id'] ?? 0);
        if ($id) {
            $existing = $this->db->one('SELECT * FROM exercises WHERE id=?', [$id]);
            if (!$existing || !Catalog::canEdit($existing, $user)) {
                throw new HttpError(404, 'Only exercises you created can be edited.');
            }
            $this->db->update('exercises', $row, 'id=?', [$id]);
        } else {
            $id = $this->db->insert('exercises', $row + ['user_id' => $uid, 'slug' => 'custom-' . bin2hex(random_bytes(6)), 'priority' => 4]);
        }
        return Catalog::shape($this->db->one('SELECT * FROM exercises WHERE id=?', [$id]));
    }
}
