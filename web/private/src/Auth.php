<?php
declare(strict_types=1);

namespace TF;

/**
 * Login sessions are random tokens kept in an HttpOnly cookie; only their
 * SHA-256 hash is stored in the database. PHP's file sessions are avoided
 * because shared hosts clean those up on their own schedule.
 */
final class Auth
{
    public const COOKIE = 'tf_session';
    private const MAX_ATTEMPTS = 8;
    private const WINDOW_MINUTES = 15;

    private Db $db;
    private int $days;
    public ?array $session = null;

    public function __construct(Db $db, array $config)
    {
        $this->db = $db;
        $this->days = max(1, (int) ($config['session_days'] ?? 60));
    }

    public static function isHttps(): bool
    {
        return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || strtolower($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    }

    public static function normUsername(string $u): string
    {
        return strtolower(trim($u));
    }

    public function createUser(string $username, string $password, string $displayName = '', string $status = 'active'): int
    {
        $username = self::normUsername($username);
        if (!preg_match('/^[a-z0-9._-]{2,64}$/', $username)) {
            throw new HttpError(422, 'Usernames use 2-64 letters, numbers, dots, dashes or underscores.');
        }
        if (strlen($password) < 10) {
            throw new HttpError(422, 'Passwords need at least 10 characters.');
        }
        if ($this->db->val('SELECT id FROM users WHERE username=?', [$username])) {
            throw new HttpError(409, 'That username is taken.');
        }
        // The very first account runs the place; everyone after it is a regular user.
        $first = (int) $this->db->val('SELECT COUNT(*) FROM users') === 0;
        return $this->db->insert('users', [
            'username' => $username,
            'password_hash' => password_hash($password, PASSWORD_DEFAULT),
            'display_name' => $displayName !== '' ? mb_substr($displayName, 0, 100) : $username,
            'role' => $first ? 'admin' : 'user',
            'status' => $first ? 'active' : $status,
            'created_at' => now_utc(),
        ]);
    }

    // ---- sign-ups with the invite code -------------------------------------

    private const INVITE_KEY = 'invite_token_hash';
    private const MAX_TOKEN_TRIES = 5;
    /** New accounts from one connection per 15 minutes, so a shared invite code can't be used to flood the site. */
    private const MAX_NEW_ACCOUNTS = 3;

    /** Whether sign-ups are open, and when the invite token was last set. The token itself is never readable. */
    public function inviteStatus(): array
    {
        $row = $this->db->one('SELECT updated_at FROM app_settings WHERE name=?', [self::INVITE_KEY]);
        return ['set' => $row !== null, 'updated_at' => $row ? to_iso($row['updated_at']) : null];
    }

    /** Sets or changes the shared invite token. An empty token closes sign-ups. Only its hash is stored. */
    public function setInviteToken(string $token): void
    {
        $token = trim($token);
        $this->db->run('DELETE FROM app_settings WHERE name=?', [self::INVITE_KEY]);
        if ($token === '') {
            return;
        }
        if (strlen($token) < 8 || strlen($token) > 100) {
            throw new HttpError(422, 'The invite token needs 8 to 100 characters.');
        }
        $this->db->insert('app_settings', ['name' => self::INVITE_KEY, 'value' => password_hash($token, PASSWORD_DEFAULT), 'updated_at' => now_utc()]);
    }

    /**
     * Someone with the invite token creates their own account from the sign-in
     * screen. It is a regular account, ready straight away (no admin approval),
     * and this device is signed in to it.
     */
    public function requestAccount(string $token, string $username, string $password, string $displayName = ''): int
    {
        $ip = $_SERVER['REMOTE_ADDR'] ?? 'cli';
        $since = now_utc(time() - self::WINDOW_MINUTES * 60);
        if ((int) $this->db->val('SELECT COUNT(*) FROM login_attempts WHERE ident=? AND attempted_at>?', ['inv:' . $ip, $since]) >= self::MAX_TOKEN_TRIES) {
            throw new HttpError(429, 'Too many tries with the wrong invite code. Wait 15 minutes and try again.');
        }
        $hash = $this->db->val('SELECT value FROM app_settings WHERE name=?', [self::INVITE_KEY]);
        if (!$hash) {
            throw new HttpError(403, 'New accounts are not open right now.');
        }
        if (!password_verify(trim($token), (string) $hash)) {
            $this->db->run('INSERT INTO login_attempts (ident, attempted_at) VALUES (?, ?)', ['inv:' . $ip, now_utc()]);
            throw new HttpError(403, 'That invite code is not right.');
        }
        if ((int) $this->db->val('SELECT COUNT(*) FROM login_attempts WHERE ident=? AND attempted_at>?', ['new:' . $ip, $since]) >= self::MAX_NEW_ACCOUNTS) {
            throw new HttpError(429, 'Several accounts were just created from here. Wait 15 minutes and try again.');
        }
        $id = $this->createUser($username, $password, $displayName);
        $this->db->run('INSERT INTO login_attempts (ident, attempted_at) VALUES (?, ?)', ['new:' . $ip, now_utc()]);
        $this->startSession($id);
        return $id;
    }

    /**
     * The admin sets a new password for someone else (#21) and signs them out
     * on every device. Their own password is changed from Settings instead.
     */
    public function adminResetPassword(array $admin, int $id, string $password): void
    {
        $target = $this->manageable($admin, $id, ['active', 'inactive']);
        $this->setPassword((int) $target['id'], $password);
        $this->logoutEverywhere((int) $target['id']);
    }

    /** Blocks sign-in and ends every session, keeping the account's workouts (#21). */
    public function deactivate(array $admin, int $id): void
    {
        $target = $this->manageable($admin, $id, ['active']);
        if (self::isAdmin($target)) {
            throw new HttpError(422, 'The admin account cannot be deactivated.');
        }
        $this->db->run("UPDATE users SET status='inactive' WHERE id=? AND status='active'", [$target['id']]);
        $this->logoutEverywhere((int) $target['id']);
    }

    public function reactivate(array $admin, int $id): void
    {
        $this->manageable($admin, $id, ['inactive']);
        $this->db->run("UPDATE users SET status='active' WHERE id=? AND status='inactive'", [$id]);
    }

    /** Another account the admin may act on, in one of the given states. */
    private function manageable(array $admin, int $id, array $statuses): array
    {
        self::requireAdmin($admin);
        if ($id === (int) $admin['id']) {
            throw new HttpError(422, 'Use Settings to change your own account.');
        }
        $target = $this->db->one('SELECT * FROM users WHERE id=?', [$id]);
        if (!$target || !in_array($target['status'] ?? 'active', $statuses, true)) {
            throw new HttpError(404, 'That account was not found. Reload the page and try again.');
        }
        return $target;
    }

    public static function isAdmin(array $user): bool
    {
        return ($user['role'] ?? 'user') === 'admin';
    }

    /** Throws unless the signed-in account is the admin. Call before any account management. */
    public static function requireAdmin(array $user): void
    {
        if (!self::isAdmin($user)) {
            throw new HttpError(403, 'Only the admin can manage accounts.');
        }
    }

    /**
     * Who this account may share a workout with: every other active account.
     * The picker shows this list and the server only accepts shares to it.
     *
     * @return array<int, array{id: int, name: string}>
     */
    public function shareTargets(array $viewer): array
    {
        $out = [];
        foreach ($this->listUsers() as $u) {
            if ($u['id'] === (int) $viewer['id']) {
                continue;
            }
            $out[] = ['id' => $u['id'], 'name' => $u['display_name']];
        }
        return $out;
    }

    /** History visibility choices (#15): only the account itself, or anyone signed in. */
    public const HISTORY_VISIBILITY = ['private', 'members'];

    /**
     * People whose workout history this account may look at (#13): every
     * other active account that has chosen to share it. Display names only.
     *
     * @return array<int, array{id: int, name: string}>
     */
    public function historyPeople(array $viewer): array
    {
        $out = [];
        foreach ($this->db->all("SELECT id, display_name FROM users WHERE status='active' AND history_visibility='members' AND id<>? ORDER BY display_name, id", [(int) $viewer['id']]) as $u) {
            $out[] = ['id' => (int) $u['id'], 'name' => $u['display_name']];
        }
        return $out;
    }

    /**
     * The account whose history the viewer asked for, if they may see it.
     * Answers 404 either way, so it does not reveal who has a private history.
     */
    public function historyOwner(array $viewer, int $ownerId): array
    {
        foreach ($this->historyPeople($viewer) as $p) {
            if ($p['id'] === $ownerId) {
                return $p;
            }
        }
        throw new HttpError(404, 'That person does not share their workout history.');
    }

    /** Accounts for the Manage Users page. Never includes password hashes. */
    public function listUsers(string $status = 'active'): array
    {
        $out = [];
        foreach ($this->db->all('SELECT id, username, display_name, role, created_at FROM users WHERE status=? ORDER BY created_at, id', [$status]) as $u) {
            $out[] = [
                'id' => (int) $u['id'],
                'username' => $u['username'],
                'display_name' => $u['display_name'],
                'role' => $u['role'],
                'created_at' => to_iso($u['created_at']),
            ];
        }
        return $out;
    }

    public function setPassword(int $userId, string $password): void
    {
        if (strlen($password) < 10) {
            throw new HttpError(422, 'Passwords need at least 10 characters.');
        }
        $this->db->run('UPDATE users SET password_hash=? WHERE id=?', [password_hash($password, PASSWORD_DEFAULT), $userId]);
    }

    public function login(string $username, string $password): array
    {
        $username = self::normUsername($username);
        $ip = $_SERVER['REMOTE_ADDR'] ?? 'cli';
        $idents = ['u:' . substr($username, 0, 100), 'ip:' . $ip];
        $since = now_utc(time() - self::WINDOW_MINUTES * 60);
        foreach ($idents as $ident) {
            $n = (int) $this->db->val('SELECT COUNT(*) FROM login_attempts WHERE ident=? AND attempted_at>?', [$ident, $since]);
            if ($n >= self::MAX_ATTEMPTS) {
                throw new HttpError(429, 'Too many sign-in attempts. Wait 15 minutes and try again.');
            }
        }
        $user = $this->db->one('SELECT * FROM users WHERE username=?', [$username]);
        // Always run a verify so a missing username takes as long as a wrong password.
        $hash = $user['password_hash'] ?? '$2y$10$OBvjizKTlIse8IXGhtydyOYRbcREjfJyxMeo/iTzChccXwrkZRM6y';
        $ok = password_verify($password, $hash) && $user !== null;
        if (!$ok) {
            foreach ($idents as $ident) {
                $this->db->run('INSERT INTO login_attempts (ident, attempted_at) VALUES (?, ?)', [$ident, now_utc()]);
            }
            throw new HttpError(401, 'Wrong username or password.');
        }
        if (($user['status'] ?? 'active') === 'inactive') {
            // Only said once the password is right, so it does not reveal which accounts exist.
            throw new HttpError(403, 'This account has been deactivated. Ask the admin to turn it back on.');
        }
        if (($user['status'] ?? 'active') !== 'active') {
            // Only said once the password is right. Accounts no longer wait for approval (030), so this is a safety net.
            throw new HttpError(403, 'This account cannot sign in yet. Ask the admin.');
        }
        $this->db->run('DELETE FROM login_attempts WHERE ident=? OR attempted_at<?', [$idents[0], now_utc(time() - 86400)]);
        if (password_needs_rehash($user['password_hash'], PASSWORD_DEFAULT)) {
            $this->db->run('UPDATE users SET password_hash=? WHERE id=?', [password_hash($password, PASSWORD_DEFAULT), $user['id']]);
        }
        $this->startSession((int) $user['id']);
        return $user;
    }

    /**
     * Sets a new password and signs the account out everywhere else. The
     * device making the change gets a fresh session and security token, so
     * it carries on without signing in again.
     */
    public function changePassword(int $userId, string $password): void
    {
        $this->setPassword($userId, $password);
        $this->logoutEverywhere($userId);
        $this->startSession($userId);
    }

    private function startSession(int $userId): void
    {
        $token = bin2hex(random_bytes(32));
        $csrf = bin2hex(random_bytes(16));
        $expires = time() + $this->days * 86400;
        $this->db->run('DELETE FROM auth_sessions WHERE expires_at<?', [now_utc()]);
        $this->db->insert('auth_sessions', [
            'token_hash' => hash('sha256', $token),
            'user_id' => $userId,
            'csrf' => $csrf,
            'created_at' => now_utc(),
            'last_seen' => now_utc(),
            'expires_at' => now_utc($expires),
        ]);
        $this->setCookie($token, $expires);
        $this->session = ['csrf' => $csrf, 'user_id' => $userId, 'token_hash' => hash('sha256', $token)];
    }

    /** Returns the signed-in user row, or null. */
    public function user(): ?array
    {
        $token = $_COOKIE[self::COOKIE] ?? '';
        if (!is_string($token) || !preg_match('/^[0-9a-f]{64}$/', $token)) {
            return null;
        }
        $hash = hash('sha256', $token);
        $s = $this->db->one('SELECT * FROM auth_sessions WHERE token_hash=? AND expires_at>?', [$hash, now_utc()]);
        if (!$s) {
            return null;
        }
        $user = $this->db->one('SELECT * FROM users WHERE id=?', [$s['user_id']]);
        if (!$user || ($user['status'] ?? 'active') !== 'active') {
            return null;
        }
        // Slide the expiry at most once a day so regular use never signs you out.
        if ($s['last_seen'] < now_utc(time() - 86400)) {
            $expires = time() + $this->days * 86400;
            $this->db->run('UPDATE auth_sessions SET last_seen=?, expires_at=? WHERE token_hash=?', [now_utc(), now_utc($expires), $hash]);
            $this->setCookie($token, $expires);
        }
        $this->session = $s;
        return $user;
    }

    public function checkCsrf(): void
    {
        $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        if (!$this->session || !is_string($sent) || !hash_equals($this->session['csrf'], $sent)) {
            throw new HttpError(403, 'Security token missing or expired. Reload the app.');
        }
    }

    public function logout(): void
    {
        $token = $_COOKIE[self::COOKIE] ?? '';
        if (is_string($token) && $token !== '') {
            $this->db->run('DELETE FROM auth_sessions WHERE token_hash=?', [hash('sha256', $token)]);
        }
        $this->setCookie('', time() - 3600);
    }

    public function logoutEverywhere(int $userId): void
    {
        $this->db->run('DELETE FROM auth_sessions WHERE user_id=?', [$userId]);
    }

    private function setCookie(string $value, int $expires): void
    {
        if (PHP_SAPI === 'cli' || headers_sent()) {
            return;
        }
        setcookie(self::COOKIE, $value, [
            'expires' => $expires,
            'path' => '/',
            'secure' => self::isHttps(),
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    }
}
