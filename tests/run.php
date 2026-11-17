<?php
declare(strict_types=1);

// Server-side checks. Runs against a throwaway SQLite database:
//   php tests/run.php

require dirname(__DIR__) . '/web/private/src/bootstrap.php';

use TF\Auth;
use TF\Catalog;
use TF\Db;
use TF\FitbodImport;
use TF\Generator;
use TF\HttpError;
use TF\Migrator;
use TF\Shares;
use TF\Strava;
use TF\Workouts;

$pass = 0;
$fail = 0;
function check(string $name, bool $ok, string $detail = ''): void
{
    global $pass, $fail;
    if ($ok) {
        $pass++;
        echo "  ok    $name\n";
    } else {
        $fail++;
        echo "  FAIL  $name" . ($detail ? "  ($detail)" : '') . "\n";
    }
}
function uuid(): string
{
    $b = random_bytes(16);
    $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
    $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
}
function throws(callable $fn, int $status): bool
{
    try {
        $fn();
    } catch (HttpError $e) {
        return $e->status === $status;
    }
    return false;
}

$file = sys_get_temp_dir() . '/thoenefit-test-' . getmypid() . '.sqlite';
@unlink($file);
// A second, empty database for the upgrade test further down.
$freshDb = function (string $suffix) use ($file): Db {
    if (getenv('TF_TEST_DB') === 'mysql') {
        $c = ['driver' => 'mysql', 'host' => getenv('TF_MYSQL_HOST') ?: '127.0.0.1', 'name' => 'thoenefit_test_' . $suffix, 'user' => getenv('TF_MYSQL_USER') ?: 'root', 'password' => (string) getenv('TF_MYSQL_PASSWORD')];
        $admin = new PDO('mysql:host=' . $c['host'], $c['user'], $c['password'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $admin->exec('DROP DATABASE IF EXISTS ' . $c['name']);
        $admin->exec('CREATE DATABASE ' . $c['name'] . ' CHARACTER SET utf8mb4');
        return new Db($c);
    }
    @unlink("$file-$suffix");
    return new Db(['driver' => 'sqlite', 'path' => "$file-$suffix"]);
};
if (getenv('TF_TEST_DB') === 'mysql') {
    // Same checks against a real MySQL server (used by the GitHub workflow):
    //   TF_TEST_DB=mysql TF_MYSQL_HOST=127.0.0.1 TF_MYSQL_USER=root TF_MYSQL_PASSWORD=root php tests/run.php
    $c = ['driver' => 'mysql', 'host' => getenv('TF_MYSQL_HOST') ?: '127.0.0.1', 'name' => 'thoenefit_test', 'user' => getenv('TF_MYSQL_USER') ?: 'root', 'password' => (string) getenv('TF_MYSQL_PASSWORD')];
    $admin = new PDO('mysql:host=' . $c['host'], $c['user'], $c['password'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $admin->exec('DROP DATABASE IF EXISTS thoenefit_test');
    $admin->exec('CREATE DATABASE thoenefit_test CHARACTER SET utf8mb4');
    $db = new Db($c);
    echo 'Running against MySQL ' . $db->val('SELECT VERSION()') . "\n";
} else {
    $db = new Db(['driver' => 'sqlite', 'path' => $file]);
}

echo "Migrations and catalog\n";
$applied = Migrator::ensure($db);
check('migrations apply on an empty database', $applied === array_keys(Migrator::files()));
check('running them again changes nothing', Migrator::ensure($db) === []);
// Two branches can each add a migration at once. The runner keys migrations by number,
// so two files with one number would hide each other and one would never run.
$migrationNumbers = array_map(static fn($f) => (int) basename($f), glob(dirname(__DIR__) . '/web/private/migrations/*.php'));
check('no two migration files share a number', count($migrationNumbers) === count(array_unique($migrationNumbers)) && count($migrationNumbers) === count(Migrator::files()), implode(',', $migrationNumbers));
$db->run('DELETE FROM schema_migrations WHERE version=2');
check('a migration that was skipped (merged out of order) is still applied', Migrator::ensure($db) === [2] && Migrator::ensure($db) === []);
$n = (int) $db->val('SELECT COUNT(*) FROM exercises');
check('catalog seeded (' . $n . ' exercises)', $n === count(Catalog::exercises()) && $n >= 80);
Catalog::sync($db);
check('re-seeding does not duplicate exercises', (int) $db->val('SELECT COUNT(*) FROM exercises') === $n);
$valid = array_flip(Catalog::equipmentKeys());
$bad = [];
foreach (Catalog::exercises() as $e) {
    foreach ($e[3] as $eq) {
        if (!isset($valid[$eq])) {
            $bad[] = "$e[0]:$eq";
        }
    }
    foreach (array_merge($e[5], $e[6]) as $m) {
        if (!isset(Catalog::MUSCLES[$m])) {
            $bad[] = "$e[0]:$m";
        }
    }
    if (!isset(Catalog::PATTERNS[$e[4]]) || !isset(Catalog::KINDS[$e[2]])) {
        $bad[] = $e[0];
    }
}
check('every catalog tag is a known equipment, muscle, movement and kind', !$bad, implode(' ', $bad));
check('catalog slugs are unique', count(array_unique(array_column(Catalog::exercises(), 0))) === count(Catalog::exercises()));
$untickable = array_column(array_filter(Catalog::exercises(), static fn($e) => $e[2] === 'machine' && !$e[3]), 1);
check('every machine needs a checkbox, so none looks available everywhere', !$untickable, implode(', ', $untickable));
$shapes = [];
foreach (Catalog::exercises() as $e) {
    $shapes[$e[0]] = ['kind' => $e[2], 'equipment' => $e[3], 'pattern' => $e[4]];
}
$full = Catalog::equipmentKeys();
$without = fn(string ...$gear) => array_values(array_diff($full, $gear));
check('specialty gear and machines are only available when ticked', Catalog::supports($shapes['machine-biceps-curl'], $full) && !Catalog::supports($shapes['machine-biceps-curl'], $without('biceps_machine')) && !Catalog::supports($shapes['ez-bar-preacher-curl'], $without('preacher_bench')) && !Catalog::supports($shapes['decline-crunch'], $without('decline_bench')) && !Catalog::supports($shapes['stability-ball-crunch'], $without('stability_ball')) && !Catalog::supports($shapes['hip-abductor-machine'], $without('hip_abduction')));
check('stability ball and medicine ball exercises no longer count as bodyweight-only', !Catalog::supports($shapes['stability-ball-pike'], [], true) && !Catalog::supports($shapes['alternating-medicine-ball-push-up'], [], true));
check('the Commercial gym preset includes the new gear', !array_diff(['medicine_ball', 'stability_ball', 'decline_bench', 'preacher_bench', 'biceps_machine', 'triceps_machine', 'ab_crunch', 'rotary_torso', 'hip_abduction', 'glute_kickback', 'back_extension_machine'], Catalog::presets()[0]['equipment']));
check('machines with a checkbox can be suggested where they fit; ones with no slot still cannot', $shapes['machine-biceps-curl']['pattern'] === 'biceps' && $shapes['machine-triceps-dip']['pattern'] === 'triceps' && $shapes['ab-crunch-machine']['pattern'] === 'core' && $shapes['hip-adductor-machine']['pattern'] === 'other' && $shapes['partner-medicine-ball-twist']['pattern'] === 'other');

echo "Accounts\n";
$auth = new Auth($db, []);
$uid = $auth->createUser('Mike', 'correct horse battery', 'Mike');
$uid2 = $auth->createUser('sam', 'another long password');
check('the first account created is the admin', $db->val('SELECT role FROM users WHERE id=?', [$uid]) === 'admin');
check('accounts created after it are regular users', $db->val('SELECT role FROM users WHERE id=?', [$uid2]) === 'user');
$adminRow = $db->one('SELECT * FROM users WHERE id=?', [$uid]);
$samRow = $db->one('SELECT * FROM users WHERE id=?', [$uid2]);
Auth::requireAdmin($adminRow);
check('account management is refused for a regular user', throws(fn() => Auth::requireAdmin($samRow), 403) && throws(fn() => Auth::requireAdmin(['id' => 9]), 403));
$listed = $auth->listUsers();
check('the account list shows who is who without password hashes', count($listed) === 2 && $listed[0]['role'] === 'admin' && $listed[1]['username'] === 'sam' && !isset($listed[0]['password_hash']) && strpos(json_encode($listed), '$2y$') === false);
check('passwords are stored hashed', password_verify('correct horse battery', $db->val('SELECT password_hash FROM users WHERE id=?', [$uid])) && strpos($db->val('SELECT password_hash FROM users WHERE id=?', [$uid]), 'correct') === false);
check('short passwords are rejected', throws(fn() => $auth->createUser('tiny', 'short'), 422));
check('duplicate usernames are rejected', throws(fn() => $auth->createUser('MIKE', 'correct horse battery'), 409));
check('wrong password is refused', throws(fn() => $auth->login('mike', 'nope'), 401));
$u = $auth->login('mike', 'correct horse battery');
check('right password signs in', (int) $u['id'] === $uid);
check('session token is stored only as a hash', (int) $db->val('SELECT COUNT(*) FROM auth_sessions WHERE LENGTH(token_hash)=64') === 1);
for ($i = 0; $i < 8; $i++) {
    try {
        $auth->login('sam', 'wrong');
    } catch (HttpError $e) {
    }
}
check('repeated failures lock sign-in for a while', throws(fn() => $auth->login('sam', 'another long password'), 429));

echo "Changing a password\n";
// Sam's failed sign-ins above also count against this machine's address; clear those so Mike can sign in.
$db->run("DELETE FROM login_attempts WHERE ident='ip:cli'");
$mikeSessions = fn() => (int) $db->val('SELECT COUNT(*) FROM auth_sessions WHERE user_id=?', [$uid]);
$auth->login('mike', 'correct horse battery');   // a second device
$auth->login('mike', 'correct horse battery');   // a third
$db->insert('auth_sessions', ['token_hash' => str_repeat('a', 64), 'user_id' => $uid2, 'csrf' => 'samcsrf', 'created_at' => \TF\now_utc(), 'last_seen' => \TF\now_utc(), 'expires_at' => \TF\now_utc(time() + 86400)]);
$before = $mikeSessions();
$oldCsrf = $auth->session['csrf'];
check('a too-short new password is refused and signs nobody out', throws(fn() => $auth->changePassword($uid, 'short'), 422) && $mikeSessions() === $before && $before === 3);
$auth->changePassword($uid, 'a brand new password');
$left = $db->all('SELECT token_hash, csrf FROM auth_sessions WHERE user_id=?', [$uid]);
check('changing the password signs out every other session for that account', count($left) === 1);
check('the device that changed it keeps a fresh session and security token', $left[0]['token_hash'] === $auth->session['token_hash'] && $left[0]['csrf'] === $auth->session['csrf'] && $auth->session['csrf'] !== $oldCsrf);
check("other people's sessions are untouched", (int) $db->val('SELECT COUNT(*) FROM auth_sessions WHERE user_id=?', [$uid2]) === 1);
check('the old password no longer works and the new one does', throws(fn() => $auth->login('mike', 'correct horse battery'), 401) && (int) $auth->login('mike', 'a brand new password')['id'] === $uid);
$auth->setPassword($uid, 'correct horse battery');
$db->run('DELETE FROM auth_sessions WHERE user_id=?', [$uid2]);

echo "Admin password resets and deactivation\n";
$admDb = $freshDb('admin');
Migrator::ensure($admDb);
$admAuth = new Auth($admDb, []);
$boss = $admAuth->createUser('boss', 'boss long password');
$pat = $admAuth->createUser('pat', 'pat long password');
$lee = $admAuth->createUser('lee', 'lee long password');
$bossRow = $admDb->one('SELECT * FROM users WHERE id=?', [$boss]);
$patRow = $admDb->one('SELECT * FROM users WHERE id=?', [$pat]);
$patSessions = fn() => (int) $admDb->val('SELECT COUNT(*) FROM auth_sessions WHERE user_id=?', [$pat]);
$admAuth->login('pat', 'pat long password');
$admAuth->login('pat', 'pat long password');
$admDb->insert('workouts', ['id' => uuid(), 'user_id' => $pat, 'gym_name' => 'Gym', 'day_type' => 'push', 'status' => 'completed', 'unit' => 'lb', 'started_at' => \TF\now_utc(), 'completed_at' => \TF\now_utc(), 'rev' => 1, 'updated_at' => \TF\now_utc()]);
check('a regular user cannot reset passwords or deactivate anyone', throws(fn() => $admAuth->adminResetPassword($patRow, $lee, 'a new long password'), 403) && throws(fn() => $admAuth->deactivate($patRow, $lee), 403) && throws(fn() => $admAuth->reactivate($patRow, $lee), 403));
check('a too-short reset password is refused and signs nobody out', throws(fn() => $admAuth->adminResetPassword($bossRow, $pat, 'short'), 422) && $patSessions() === 2);
$admAuth->adminResetPassword($bossRow, $pat, 'reset by the admin');
check('the admin can reset a password, which signs that person out everywhere', $patSessions() === 0);
check('the old password stops working and the new one works', throws(fn() => $admAuth->login('pat', 'pat long password'), 401) && (int) $admAuth->login('pat', 'reset by the admin')['id'] === $pat);
check("the admin's own account is changed from Settings, not here", throws(fn() => $admAuth->adminResetPassword($bossRow, $boss, 'another long one'), 422) && throws(fn() => $admAuth->deactivate($bossRow, $boss), 422));
check('an account that does not exist is reported as not found', throws(fn() => $admAuth->deactivate($bossRow, 9999), 404));
$admAuth->deactivate($bossRow, $pat);
check('deactivating signs the account out everywhere', $patSessions() === 0 && $admDb->val('SELECT status FROM users WHERE id=?', [$pat]) === 'inactive');
check('a deactivated account cannot sign in, and is told why only with the right password', throws(fn() => $admAuth->login('pat', 'reset by the admin'), 403) && throws(fn() => $admAuth->login('pat', 'wrong password!'), 401));
$admDb->run("DELETE FROM login_attempts");
check('its workouts are kept', (int) $admDb->val('SELECT COUNT(*) FROM workouts WHERE user_id=?', [$pat]) === 1);
check('it leaves the account list and appears under deactivated accounts', !in_array('pat', array_column($admAuth->listUsers(), 'username'), true) && array_column($admAuth->listUsers('inactive'), 'username') === ['pat']);
check('it is no longer offered for sharing a workout', !in_array($pat, array_column($admAuth->shareTargets($bossRow), 'id'), true));
check('deactivating it twice is reported, not repeated', throws(fn() => $admAuth->deactivate($bossRow, $pat), 404));
$admAuth->adminResetPassword($bossRow, $pat, 'reset while it was off');
check('a deactivated account can still have its password reset', $admDb->val('SELECT status FROM users WHERE id=?', [$pat]) === 'inactive');
$admAuth->reactivate($bossRow, $pat);
check('turning it back on lets it sign in again, with its history intact', (int) $admAuth->login('pat', 'reset while it was off')['id'] === $pat && (int) $admDb->val('SELECT COUNT(*) FROM workouts WHERE user_id=?', [$pat]) === 1);
check('only a deactivated account can be turned back on', throws(fn() => $admAuth->reactivate($bossRow, $lee), 404));
$admDb->run("UPDATE users SET role='admin' WHERE id=?", [$lee]);
check('an admin account cannot be deactivated', throws(fn() => $admAuth->deactivate($bossRow, $lee), 422));
unset($admDb, $admAuth);
foreach (['', '-wal', '-shm'] as $sfx) {
    @unlink("$file-admin$sfx");
}

echo "Sign-ups with the invite code\n";
$reqDb = $freshDb('requests');
Migrator::ensure($reqDb);
$ra = new Auth($reqDb, []);
$boss = $ra->createUser('boss', 'boss-password-123');
check('sign-ups are closed until the admin sets a token', $ra->inviteStatus()['set'] === false && throws(fn() => $ra->requestAccount('anything-at-all', 'eve', 'eve-password-123'), 403));
check('a token that is too short is refused', throws(fn() => $ra->setInviteToken('short'), 422));
$ra->setInviteToken('gym-crew-2026');
$stored = $reqDb->val("SELECT value FROM app_settings WHERE name='invite_token_hash'");
check('the invite token is stored hashed, never as typed', $ra->inviteStatus()['set'] === true && strpos($stored, 'gym-crew') === false && password_verify('gym-crew-2026', $stored));
check('a wrong token is refused before anything is created', throws(fn() => $ra->requestAccount('not-the-token', 'eve', 'eve-password-123'), 403) && (int) $reqDb->val('SELECT COUNT(*) FROM users') === 1);
$sessionsBefore = (int) $reqDb->val('SELECT COUNT(*) FROM auth_sessions');
$rid = $ra->requestAccount(' gym-crew-2026 ', 'Dana', 'dana-own-password', 'Dana R');
$row = $reqDb->one('SELECT * FROM users WHERE id=?', [$rid]);
check('the right token creates a regular account that is active straight away, with no approval', $row['status'] === 'active' && $row['role'] === 'user' && $row['username'] === 'dana' && $row['display_name'] === 'Dana R');
check('the new account is signed in on that device', (int) $reqDb->val('SELECT COUNT(*) FROM auth_sessions WHERE user_id=?', [$rid]) === 1 && (int) $reqDb->val('SELECT COUNT(*) FROM auth_sessions') === $sessionsBefore + 1);
check('it is listed with the other accounts', in_array('dana', array_column($ra->listUsers(), 'username'), true) && count($ra->listUsers('pending')) === 0);
check('the person\'s password is their own, separate from the invite token', password_verify('dana-own-password', $row['password_hash']) && !password_verify('gym-crew-2026', $row['password_hash']));
check('the invite token does not work as a sign-in password', throws(fn() => $ra->login('dana', 'gym-crew-2026'), 401));
$in = $ra->login('dana', 'dana-own-password');
check('they can sign in again later with the password they chose', (int) $in['id'] === $rid && $in['role'] === 'user');
check('a username cannot be taken twice', throws(fn() => $ra->requestAccount('gym-crew-2026', 'dana', 'another-password-1'), 409) && throws(fn() => $ra->requestAccount('gym-crew-2026', 'boss', 'another-password-1'), 409));
check('the usual username and password rules apply', throws(fn() => $ra->requestAccount('gym-crew-2026', 'x', 'long-enough-password'), 422) && throws(fn() => $ra->requestAccount('gym-crew-2026', 'okname', 'short'), 422));
$ra->setInviteToken('brand-new-token');
check('changing the token stops the old one working', throws(fn() => $ra->requestAccount('gym-crew-2026', 'late', 'late-password-123'), 403));
$ra->requestAccount('brand-new-token', 'late', 'late-password-123');
$ra->setInviteToken('');
check('clearing the token closes sign-ups and keeps the accounts already made', $ra->inviteStatus()['set'] === false && throws(fn() => $ra->requestAccount('brand-new-token', 'later', 'later-password-12'), 403) && count($ra->listUsers()) === 3);
$ra->setInviteToken('third-token-here');
$ra->requestAccount('third-token-here', 'third', 'third-password-12'); // the third from this connection in 15 minutes
check('three accounts from one connection, then a pause', throws(fn() => $ra->requestAccount('third-token-here', 'fourth', 'fourth-password-1'), 429) && (int) $reqDb->val("SELECT COUNT(*) FROM users WHERE username='fourth'") === 0);
$reqDb->run("DELETE FROM login_attempts WHERE ident LIKE 'new:%'");
$ra->requestAccount('third-token-here', 'fourth', 'fourth-password-1');
check('after the pause, sign-ups work again', (int) $reqDb->val("SELECT COUNT(*) FROM users WHERE username='fourth'") === 1);
$reqDb->run("DELETE FROM login_attempts WHERE ident LIKE 'inv:%'");
for ($i = 0; $i < 5; $i++) {
    try {
        $ra->requestAccount('guess-' . $i . '-wrong', 'guesser', 'guesser-password');
    } catch (HttpError $e) {
    }
}
check('repeated wrong tokens are locked out for a while, even with the right one', throws(fn() => $ra->requestAccount('third-token-here', 'guesser', 'guesser-password'), 429));
// Migration 030: anyone left waiting from the old approval flow can sign in now.
$reqDb->run("UPDATE users SET status='pending' WHERE username='late'");
$reqDb->run("UPDATE users SET status='inactive' WHERE username='fourth'");
(require dirname(__DIR__) . '/web/private/migrations/030_no_account_approval.php')($reqDb, new Migrator($reqDb));
check('migration 030 lets anyone still waiting sign in, and leaves deactivated accounts alone', $reqDb->val("SELECT status FROM users WHERE username='late'") === 'active' && $reqDb->val("SELECT status FROM users WHERE username='fourth'") === 'inactive');
unset($ra, $reqDb);
@unlink("$file-requests");
@unlink("$file-requests-wal");
@unlink("$file-requests-shm");

echo "Generator\n";
$mkGym = function (int $uid, string $name, array $equipment) use ($db): array {
    $id = $db->insert('gyms', ['user_id' => $uid, 'name' => $name, 'equipment' => json_encode($equipment), 'increments' => '{}', 'created_at' => TF\now_utc()]);
    return Generator::gymShape($db->one('SELECT * FROM gyms WHERE id=?', [$id]));
};
$big = $mkGym($uid, 'Iron Works', Catalog::equipmentKeys());
$home = $mkGym($uid, 'Home', ['dumbbells', 'bench']);
$none = $mkGym($uid, 'Hotel room', []);
$other = $mkGym($uid, 'Second gym', Catalog::equipmentKeys());
$user = $db->one('SELECT * FROM users WHERE id=?', [$uid]);
$gen = new Generator($db);
$wk = new Workouts($db);
$exById = [];
foreach (Catalog::forUser($db, $uid) as $e) {
    $exById[$e['id']] = $e;
}
$bySlug = [];
foreach ($db->all('SELECT id, slug FROM exercises') as $r) {
    $bySlug[$r['slug']] = (int) $r['id'];
}

$violations = [];
$thin = [];
foreach ([[$big, 3], [$home, 3], [$none, 2]] as [$gym, $min]) {
    foreach (['full', 'upper', 'lower', 'push', 'pull', 'legs'] as $day) {
        $w = $gen->generate($user, $gym, ['day_type' => $day, 'minutes' => 60]);
        foreach ($w['exercises'] as $b) {
            if (!Catalog::supports($exById[$b['exercise_id']], $gym['equipment'])) {
                $violations[] = "{$gym['name']}/$day: {$b['name']} needs different equipment";
            }
        }
        if (count($w['exercises']) < $min && !($gym['name'] === 'Hotel room' && $day === 'pull')) {
            $thin[] = "{$gym['name']}/$day=" . count($w['exercises']);
        }
    }
}
check('never picks an exercise the gym lacks equipment for (3 gyms x 6 days)', !$violations, implode('; ', $violations));
check('every built-in split day fills a session', !$thin, implode(' ', $thin));
$w = $gen->generate($user, $none, ['day_type' => 'pull']);
check('a gym with no pulling equipment says so instead of inventing exercises', count($w['skipped']) > 0);

$a = $gen->generate($user, $big, ['day_type' => 'push', 'now' => 1800000000]);
$b = $gen->generate($user, $big, ['day_type' => 'push', 'now' => 1800000000]);
check('same inputs give the same workout', json_encode($a) === json_encode($b));
$short = $gen->generate($user, $big, ['day_type' => 'push', 'minutes' => 25]);
$long = $gen->generate($user, $big, ['day_type' => 'push', 'minutes' => 90]);
check('time available changes the number of exercises (' . count($short['exercises']) . ' vs ' . count($long['exercises']) . ')', count($short['exercises']) < count($long['exercises']) && $short['est_minutes'] <= 35);
check('each suggestion carries a reason', !array_filter($a['exercises'], fn($x) => strlen($x['reason']) < 20));

$first = $a['exercises'][0];
$second = $a['exercises'][1];
$regen = $gen->generate($user, $big, ['day_type' => 'push', 'locked' => [$first['slot'] => $first['exercise_id']], 'avoid' => array_column($a['exercises'], 'exercise_id')]);
check('a locked exercise survives regenerate', $regen['exercises'][0]['exercise_id'] === $first['exercise_id'] && $regen['exercises'][0]['locked']);
check('regenerate swaps the unlocked ones', $regen['exercises'][1]['exercise_id'] !== $second['exercise_id']);
$alts = $gen->alternatives($uid, $home, $bySlug['dumbbell-bench-press']);
$altOk = $alts && !array_filter($alts, function ($x) use ($exById, $home) {
    return !Catalog::supports($exById[$x['exercise_id']], $home['equipment']);
});
check('swap alternatives respect the gym too', (bool) $altOk);

$exercise = fn(string $slug) => $exById[$bySlug[$slug]];
check('one dumbbell unlocks goblet squats and floor presses, but a dumbbell bench press needs a pair',
    Catalog::supports($exercise('goblet-squat'), ['single_dumbbell']) &&
    Catalog::supports($exercise('one-arm-dumbbell-floor-press'), ['single_dumbbell']) &&
    !Catalog::supports($exercise('dumbbell-bench-press'), ['single_dumbbell', 'bench']) &&
    Catalog::supports($exercise('dumbbell-bench-press'), ['dumbbells', 'bench']));
check('a legacy dumbbell pair also unlocks one-dumbbell exercises',
    Catalog::supports($exercise('goblet-squat'), $home['equipment']));
check('step-ups accept a box or a bench and require a dumbbell only for the weighted version',
    Catalog::supports($exercise('bodyweight-step-up'), ['step_box']) &&
    !Catalog::supports($exercise('dumbbell-step-up'), ['step_box']) &&
    Catalog::supports($exercise('dumbbell-step-up'), ['single_dumbbell', 'step_box']) &&
    Catalog::supports($exercise('dumbbell-step-up'), $home['equipment']) &&
    !Catalog::supports($exercise('dumbbell-bench-press'), ['dumbbells', 'step_box']));
$livingRoom = $mkGym($uid, 'Living room', ['single_dumbbell', 'step_box']);
$stepUp = $gen->generate($user, $livingRoom, ['day_type' => 'legs', 'locked' => ['single' => $bySlug['dumbbell-step-up']]]);
check('the generator can use a step-up in a gym with only one dumbbell and a box',
    in_array($bySlug['dumbbell-step-up'], array_column($stepUp['exercises'], 'exercise_id'), true));
$noGear = $gen->generate($user, $big, [
    'day_type' => 'push',
    'bodyweight_only' => true,
    'locked' => ['press' => $bySlug['dumbbell-bench-press'], 'incline' => $bySlug['feet-elevated-push-up']],
]);
check('bodyweight-only workouts ignore gym equipment and incompatible locked exercises',
    $noGear['bodyweight_only'] && count($noGear['exercises']) >= 3 &&
    !array_filter($noGear['exercises'], function ($b) use ($exById) {
        $ex = $exById[$b['exercise_id']];
        return $ex['kind'] !== 'bodyweight' || $ex['equipment'] !== [] || $b['suggested_weight'] !== null;
    }));
$noGearPull = $gen->generate($user, $big, ['day_type' => 'pull', 'bodyweight_only' => true]);
check('bodyweight-only workouts omit warnings about slots that need equipment',
    $noGearPull['exercises'] && $noGearPull['skipped'] === []);
$noGearSwaps = $gen->alternatives($uid, $big, $bySlug['dumbbell-bench-press'], [], true);
check('bodyweight-only swap results also require no equipment',
    $noGearSwaps && !array_filter($noGearSwaps, fn($a) => !Catalog::supports($exById[$a['exercise_id']], [], true)));

echo "Logging, progression and sync\n";
// Helper: build a workout document the way the phone does.
$doc = function (array $gym, string $day, array $lifts, string $when, string $status = 'completed') {
    $exs = [];
    foreach ($lifts as [$exId, $min, $max, $sets]) {
        $rows = [];
        foreach ($sets as $s) {
            $rows[] = ['id' => uuid(), 'weight' => $s[0], 'reps' => $s[1], 'warmup' => $s[2] ?? false, 'done' => $s[3] ?? true, 'done_at' => $when];
        }
        $exs[] = ['id' => uuid(), 'exercise_id' => $exId, 'rep_min' => $min, 'rep_max' => $max, 'target_sets' => count($rows), 'sets' => $rows];
    }
    return ['id' => uuid(), 'gym_id' => $gym['id'], 'day_type' => $day, 'status' => $status, 'unit' => 'lb', 'started_at' => $when, 'completed_at' => $status === 'completed' ? $when : null, 'rev' => 1, 'exercises' => $exs];
};
$bench = $bySlug['barbell-bench-press'];
$press = $bySlug['machine-chest-press'];
$ago = fn(int $days) => gmdate('Y-m-d\TH:i:s\Z', time() - $days * 86400);

$blk = $gen->block($user, $big, $exById[$bench]);
check('no history: no weight suggested, and it says why', $blk['suggested_weight'] === null && $blk['action'] === 'new');

// Session 1: warm-up + three working sets, all at the top of 6-10.
$d1 = $doc($big, 'push', [[$bench, 6, 10, [[45, 10, true], [135, 10], [135, 10], [135, 10]]]], $ago(4));
$r = $wk->save($uid, $d1);
check('workout saves', $r['ok'] === true);
$blk = $gen->block($user, $big, $exById[$bench]);
check('top of the range on every working set -> next increment (135 -> ' . $blk['suggested_weight'] . ')', $blk['suggested_weight'] === 140.0 && $blk['action'] === 'increase' && $blk['suggested_reps'] === 6);
check('warm-up sets are ignored by progression', count($blk['previous']['sets']) === 3);

// Editing that past workout (one set was really 8 reps) must change the advice.
$d1['exercises'][0]['sets'][3]['reps'] = 8;
$d1['rev'] = 2;
$wk->save($uid, $d1);
$blk = $gen->block($user, $big, $exById[$bench]);
check('editing a past workout updates the next recommendation (stay at 135)', $blk['suggested_weight'] === 135.0 && $blk['action'] === 'stay' && $blk['suggested_reps'] === 9);

// Idempotent sync: the same save delivered three times, then an out-of-date one.
$before = (int) $db->val('SELECT COUNT(*) FROM workout_sets');
$wk->save($uid, $d1);
$wk->save($uid, $d1);
check('re-sending the same save creates no duplicate sets', (int) $db->val('SELECT COUNT(*) FROM workout_sets') === $before && (int) $db->val('SELECT COUNT(*) FROM workout_exercises WHERE workout_id=?', [$d1['id']]) === 1);
$stale = $d1;
$stale['rev'] = 1;
$stale['exercises'][0]['sets'][3]['reps'] = 10;
$r = $wk->save($uid, $stale);
check('an older queued edit arriving late is rejected, not applied', $r['ok'] === false && !empty($r['conflict']) && $r['workout']['exercises'][0]['sets'][3]['reps'] === 8);

// Resume: an in-progress workout comes back exactly as saved.
$act = $doc($big, 'pull', [[$bySlug['barbell-row'], 6, 10, [[95, 8], [95, null, false, false]]]], $ago(0), 'active');
$wk->save($uid, $act);
$got = $wk->active($uid);
check('an unfinished workout can be resumed with its sets intact', $got && $got['id'] === $act['id'] && count($got['exercises'][0]['sets']) === 2 && $got['exercises'][0]['sets'][0]['done'] === true && $got['exercises'][0]['sets'][1]['done'] === false);
$blk = $gen->block($user, $big, $exById[$bySlug['barbell-row']]);
check('an unfinished workout does not count as history yet', $blk['action'] === 'new');
// Adding a set while offline and syncing later: rev 2 replaces rev 1 wholesale.
$act['exercises'][0]['sets'][1] = ['id' => $act['exercises'][0]['sets'][1]['id'], 'weight' => 95, 'reps' => 8, 'done' => true];
$act['exercises'][0]['sets'][] = ['id' => uuid(), 'weight' => 95, 'reps' => 7, 'done' => true];
$act['rev'] = 5;
$wk->save($uid, $act);
$wk->save($uid, $act);
$got = $wk->active($uid);
check('queued edits apply once after reconnect', count($got['exercises'][0]['sets']) === 3 && $got['rev'] === 5);
$act['status'] = 'completed';
$act['completed_at'] = $ago(0);
$act['rev'] = 6;
$wk->save($uid, $act);
check('finishing clears the in-progress workout', $wk->active($uid) === null);

echo "Equipment variants, units and rotation\n";
$dm = $doc($big, 'push', [[$press, 6, 10, [[100, 10], [100, 10], [100, 10]]]], $ago(3));
$wk->save($uid, $dm);
$here = $gen->block($user, $big, $exById[$press]);
$there = $gen->block($user, $other, $exById[$press]);
check('machine history stays with the gym it was logged at', $here['suggested_weight'] === 110.0 && $there['suggested_weight'] === null && strpos($there['reason'], 'another gym') !== false);
$benchElsewhere = $gen->block($user, $other, $exById[$bench]);
check('barbell history follows you between gyms', $benchElsewhere['suggested_weight'] === 135.0);
$kgUser = ['unit' => 'kg'] + $user;
$kg = $gen->block($kgUser, $big, $exById[$bench]);
check('pound history converts to a loadable kilogram weight (' . $kg['suggested_weight'] . ' kg)', $kg['suggested_weight'] === 60.0 || $kg['suggested_weight'] === 62.5);
$custom = $big;
$custom['increments'] = ['barbell' => 2.5];
$d2 = $doc($big, 'push', [[$bench, 6, 10, [[135, 10], [135, 10], [135, 10]]]], $ago(2));
$wk->save($uid, $d2);
check('a gym\'s own weight increment is used', $gen->block($user, $custom, $exById[$bench])['suggested_weight'] === 137.5);
$ppl = ['split_type' => 'ppl'] + $user;
check('push/pull/legs moves to the next day after the last workout (' . $gen->nextDayType($uid, 'ppl') . ')', $gen->nextDayType($uid, 'ppl') === 'legs');
check('upper/lower starts at upper when the last day was not part of it', $gen->nextDayType($uid, 'upper_lower') === 'upper');

echo "Moving the admin's own exercises into the default library\n";
$pdb = $freshDb('promote');
Migrator::ensure($pdb);
$pa = new Auth($pdb, []);
$adm = $pa->createUser('mike', 'mike-password-12');
$pat = $pa->createUser('pat', 'pat-password-123');
$admRow = $pdb->one('SELECT * FROM users WHERE id=?', [$adm]);
$patRow = $pdb->one('SELECT * FROM users WHERE id=?', [$pat]);
$mkEx = fn(int $owner, string $name, string $slug, string $pattern = 'horizontal_push') => $pdb->insert('exercises', ['user_id' => $owner, 'slug' => $slug, 'name' => $name, 'kind' => 'machine', 'equipment' => '["chest_press"]', 'pattern' => $pattern, 'muscles_main' => '["chest"]', 'muscles_assist' => '[]', 'cues' => '', 'priority' => 4]);
$hs = $mkEx($adm, 'Hammerstrength Pec Press', TF\FitbodImport::slug('Hammerstrength Pec Press'));
$roller = $mkEx($adm, 'Wrist Roller', 'custom-bbbbbbbbbbbb', 'other');
$clash = $mkEx($adm, 'push-up', 'custom-cccccccccccc');
$patOwn = $mkEx($pat, 'Pat Press', 'custom-dddddddddddd');
$pgId = $pdb->insert('gyms', ['user_id' => $adm, 'name' => 'Mike gym', 'equipment' => json_encode(Catalog::equipmentKeys()), 'increments' => '{}', 'created_at' => TF\now_utc()]);
$pg = Generator::gymShape($pdb->one('SELECT * FROM gyms WHERE id=?', [$pgId]));
$ogId = $pdb->insert('gyms', ['user_id' => $pat, 'name' => 'Pat gym', 'equipment' => json_encode(Catalog::equipmentKeys()), 'increments' => '{}', 'created_at' => TF\now_utc()]);
$og = Generator::gymShape($pdb->one('SELECT * FROM gyms WHERE id=?', [$ogId]));
$wkp = new Workouts($pdb);
$genp = new Generator($pdb);
$hist = $doc($pg, 'push', [[$hs, 6, 10, [[100, 10], [100, 10], [100, 10]]]], $ago(3));
$wkp->save($adm, $hist);
$shapeOf = fn(int $id) => Catalog::shape($pdb->one('SELECT * FROM exercises WHERE id=?', [$id]));
$before = $genp->block($admRow, $pg, $shapeOf($hs));
$keyBefore = $pdb->val('SELECT variant_key FROM workout_exercises WHERE exercise_id=?', [$hs]);
$seenBy = fn(int $u) => array_column(Catalog::forUser($pdb, $u), 'id');
check('before the move, other accounts cannot see the admin\'s own exercises', !in_array($hs, $seenBy($pat), true));
$res = Catalog::promote($pdb, $adm);
check('the admin\'s own exercises move into the default library', $res['promoted'] === 2 && $pdb->val('SELECT user_id FROM exercises WHERE id=?', [$hs]) === null && (int) $pdb->val('SELECT promoted_from FROM exercises WHERE id=?', [$hs]) === $adm);
check('every account can now see them, and they are no longer marked as someone\'s own', in_array($hs, $seenBy($pat), true) && in_array($roller, $seenBy($pat), true) && $shapeOf($hs)['custom'] === false && $shapeOf($hs)['shared'] === true);
$after = $genp->block($admRow, $pg, $shapeOf($hs));
check('existing workout history is untouched: same exercise id, same history key, same next suggestion (' . $after['suggested_weight'] . ' lb)', count($wkp->exerciseHistory($adm, $hs)) === 1 && $pdb->val('SELECT variant_key FROM workout_exercises WHERE exercise_id=?', [$hs]) === $keyBefore && $after['suggested_weight'] === $before['suggested_weight'] && $after['suggested_weight'] === 110.0 && $wkp->get($adm, $hist['id'])['exercises'][0]['name'] === 'Hammerstrength Pec Press');
$alts = array_column($genp->alternatives($pat, $og, (int) $pdb->val("SELECT id FROM exercises WHERE slug='machine-chest-press'")), 'exercise_id');
$patDoc = $doc($og, 'push', [[$hs, 6, 10, [[40, 8]]]], $ago(1));
check('other accounts can pick them, be offered them as alternatives, and log them', in_array($hs, $alts, true) && $wkp->save($pat, $patDoc)['ok'] === true && $genp->block($patRow, $og, $shapeOf($hs))['suggested_weight'] === 40.0);
check('each account keeps its own history for a moved exercise', count($wkp->exerciseHistory($pat, $hs)) === 1 && count($wkp->exerciseHistory($adm, $hs)) === 1);
check('an exercise whose name the default library already has stays the admin\'s own', $res['skipped'] === ['push-up'] && (int) $pdb->val('SELECT user_id FROM exercises WHERE id=?', [$clash]) === $adm);
check('other people\'s own exercises are left alone', (int) $pdb->val('SELECT user_id FROM exercises WHERE id=?', [$patOwn]) === $pat && !in_array($patOwn, $seenBy($adm), true));
$rowOf = fn(int $id) => $pdb->one('SELECT * FROM exercises WHERE id=?', [$id]);
check('the admin can still edit or archive a moved exercise; nobody else can, and built-in ones stay read-only', Catalog::canEdit($rowOf($hs), $admRow) && !Catalog::canEdit($rowOf($hs), $patRow) && !Catalog::canEdit($pdb->one("SELECT * FROM exercises WHERE slug='push-up'"), $admRow) && Catalog::canEdit($rowOf($patOwn), $patRow) && !Catalog::canEdit($rowOf($patOwn), $admRow));
check('moving again changes nothing', Catalog::promote($pdb, $adm)['promoted'] === 0 && (int) $pdb->val('SELECT COUNT(*) FROM exercises WHERE promoted_from IS NOT NULL') === 2);
$planned = (new TF\FitbodImport($pdb))->plan($pat, ['names' => ['Hammerstrength Pec Press' => ['sets' => 3, 'weighted' => true]]]);
check('a Fitbod import by another account uses the moved exercise instead of making a duplicate', $planned[0]['action'] === 'match' && $planned[0]['exercise_id'] === $hs);
Catalog::sync($pdb);
check('refreshing the built-in catalog leaves moved exercises in place', $pdb->val('SELECT name FROM exercises WHERE id=?', [$hs]) === 'Hammerstrength Pec Press' && (int) $pdb->val('SELECT COUNT(*) FROM exercises WHERE user_id IS NULL') === count(Catalog::exercises()) + 2);
// The same thing through the migration, on a database that already has accounts and exercises.
$mdb = $freshDb('promote2');
Migrator::ensure($mdb, 3);
foreach ([['owner', 'admin', '2025-01-01 00:00:00'], ['member', 'user', '2025-02-01 00:00:00']] as [$n, $role, $when]) {
    $mdb->insert('users', ['username' => $n, 'password_hash' => 'x', 'display_name' => $n, 'role' => $role, 'created_at' => $when]);
}
$ownerId = (int) $mdb->val("SELECT id FROM users WHERE username='owner'");
$memberId = (int) $mdb->val("SELECT id FROM users WHERE username='member'");
$mk2 = fn(int $owner, string $name) => $mdb->insert('exercises', ['user_id' => $owner, 'slug' => 'custom-' . md5($name), 'name' => $name, 'kind' => 'dumbbell', 'equipment' => '[]', 'pattern' => 'other', 'muscles_main' => '["forearms"]', 'muscles_assist' => '[]', 'cues' => '', 'priority' => 4]);
$o1 = $mk2($ownerId, 'Owner Special');
$m1 = $mk2($memberId, 'Member Special');
Migrator::ensure($mdb);
check('the migration moves the admin\'s exercises and nobody else\'s', $mdb->val('SELECT user_id FROM exercises WHERE id=?', [$o1]) === null && (int) $mdb->val('SELECT promoted_from FROM exercises WHERE id=?', [$o1]) === $ownerId && (int) $mdb->val('SELECT user_id FROM exercises WHERE id=?', [$m1]) === $memberId);

echo "New built-ins take over exercises an earlier Fitbod import made\n";
// Production as it was before #65: the admin imported Fitbod and their own
// exercises were moved into the default library; a member imported too.
$adb = $freshDb('adopt');
Migrator::ensure($adb, 9);
$adb->run('DELETE FROM exercises WHERE user_id IS NULL AND priority=9'); // the #65 built-ins did not exist yet
foreach ([['owner', 'admin', '2025-01-01 00:00:00'], ['member', 'user', '2025-02-01 00:00:00']] as [$n, $role, $when]) {
    $adb->insert('users', ['username' => $n, 'password_hash' => 'x', 'display_name' => $n, 'role' => $role, 'created_at' => $when]);
}
$ownerId = (int) $adb->val("SELECT id FROM users WHERE username='owner'");
$memberId = (int) $adb->val("SELECT id FROM users WHERE username='member'");
$imported = fn(?int $owner, string $fitbod, string $kind, ?int $from = null) => $adb->insert('exercises', ['user_id' => $owner, 'slug' => FitbodImport::slug($fitbod), 'name' => $fitbod, 'kind' => $kind, 'equipment' => '[]', 'pattern' => 'other', 'muscles_main' => '[]', 'muscles_assist' => '[]', 'cues' => '', 'priority' => 4, 'promoted_from' => $from]);
$preacher = $imported(null, 'Machine Preacher Curl', 'machine', $ownerId);      // promoted
$sled = $imported($ownerId, 'Leg Press', 'machine');                              // stayed the admin's: "Leg Press" was taken
$memberZottman = $imported($memberId, 'Zottman Curl', 'dumbbell');                // another account's own
$adb->insert('workout_exercises', ['id' => uuid(), 'workout_id' => uuid(), 'user_id' => $ownerId, 'exercise_id' => $preacher, 'variant_key' => $preacher . '@1', 'pos' => 0, 'target_sets' => 3, 'rep_min' => 8, 'rep_max' => 12]);
Migrator::ensure($adb);
$row = fn(int $id) => $adb->one('SELECT * FROM exercises WHERE id=?', [$id]);
check('a promoted exercise becomes the built-in in place: same id, built-in name, details and cues', $row($preacher)['slug'] === 'machine-preacher-curl' && $row($preacher)['name'] === 'Machine Preacher Curl' && (int) $row($preacher)['priority'] === 9 && $row($preacher)['cues'] !== '' && $row($preacher)['user_id'] === null);
check('its workout history still points at it', $adb->val('SELECT exercise_id FROM workout_exercises WHERE user_id=?', [$ownerId]) == $preacher);
check('the library has one Machine Preacher Curl, not two', (int) $adb->val("SELECT COUNT(*) FROM exercises WHERE user_id IS NULL AND name='Machine Preacher Curl'") === 1);
check('the admin\'s own copy that could not be promoted is taken over and renamed', $row($sled)['user_id'] === null && $row($sled)['slug'] === 'plate-loaded-leg-press' && $row($sled)['name'] === 'Plate-Loaded Leg Press' && (int) $row($sled)['promoted_from'] === $ownerId);
check('another account\'s own exercise is left alone, and the built-in is added beside it', (int) $row($memberZottman)['user_id'] === $memberId && $row($memberZottman)['slug'] === FitbodImport::slug('Zottman Curl') && (int) $adb->val("SELECT COUNT(*) FROM exercises WHERE user_id IS NULL AND slug='zottman-curl'") === 1);
check('every built-in is present afterwards', !array_diff(array_column(Catalog::exercises(), 0), array_column($adb->all('SELECT slug FROM exercises WHERE user_id IS NULL'), 'slug')) && (int) $adb->val('SELECT COUNT(*) FROM exercises WHERE user_id IS NULL') === count(Catalog::exercises()));
$countAfter = (int) $adb->val('SELECT COUNT(*) FROM exercises');
$adoptedAgain = FitbodImport::adoptForBuiltins($adb);
Catalog::sync($adb);
check('running it again changes nothing', $adoptedAgain === 0 && (int) $adb->val('SELECT COUNT(*) FROM exercises') === $countAfter);
$replan = array_column((new FitbodImport($adb))->plan($ownerId, ['names' => ['Machine Preacher Curl' => ['sets' => 3, 'weighted' => true], 'Leg Press' => ['sets' => 3, 'weighted' => true]]]), null, 'name');
check('re-importing the same Fitbod file matches the same exercises', $replan['Machine Preacher Curl']['exercise_id'] === $preacher && $replan['Leg Press']['exercise_id'] === $sled);
unset($adb);
@unlink("$file-adopt");

unset($pa, $wkp, $genp, $pdb, $mdb);
foreach (['promote', 'promote2'] as $sfx) {
    @unlink("$file-$sfx");
    @unlink("$file-$sfx-wal");
    @unlink("$file-$sfx-shm");
}

echo "Recovery estimate\n";
$hard = $doc($big, 'push', [[$bench, 6, 10, [[135, 8], [135, 8], [135, 8], [135, 8]]], [$bySlug['cable-fly'], 10, 15, [[30, 12], [30, 12], [30, 12]]]], $ago(0));
$wk->save($uid, $hard);
$stats = $gen->muscleStats($uid);
check('just-trained chest reads as not recovered (' . $stats['chest']['recovery'] . '%), untouched quads as fresh', $stats['chest']['recovery'] < 50 && $stats['quads']['recovery'] === 100);
check('weekly sets count primary muscles fully and secondary at half', $stats['chest']['weekly_sets'] >= 7 && $stats['triceps']['weekly_sets'] > 0 && $stats['triceps']['weekly_sets'] < $stats['chest']['weekly_sets']);
$tired = $gen->generate($user, $big, ['day_type' => 'push']);
check('a session for a tired muscle drops a set and says so', $tired['exercises'][0]['target_sets'] === 2 && strpos($tired['exercises'][0]['reason'], 'Estimated recovery') !== false);

echo "History, export and privacy\n";
$hist = $wk->history($uid);
check('history lists finished workouts newest first', count($hist) === 5 && $hist[0]['started_at'] >= $hist[1]['started_at']);
$sessions = $wk->exerciseHistory($uid, $bench);
check('per-exercise trend has one point per session', count($sessions) === 3 && $sessions[0]['date'] <= $sessions[1]['date']);
$fh = fopen('php://memory', 'w+');
$wk->exportCsv($uid, $fh);
rewind($fh);
$csv = stream_get_contents($fh);
check('CSV export has a header and one row per set', substr_count(trim($csv), "\n") === (int) $db->val('SELECT COUNT(*) FROM workout_sets') && strpos($csv, 'Barbell Bench Press') !== false);
check('one account cannot read another\'s workout', $wk->get($uid2, $d1['id']) === null);
check('one account cannot overwrite another\'s workout', throws(fn() => $wk->save($uid2, $d1), 403));
check('one account cannot delete another\'s workout', throws(fn() => $wk->delete($uid2, $d1['id']), 403));
$wk->delete($uid, $d2['id']);
check('deleting a workout removes its sets', (int) $db->val('SELECT COUNT(*) FROM workout_sets WHERE workout_id=?', [$d2['id']]) === 0);

echo "Seeing each other's history\n";
$mikeRow = $db->one('SELECT * FROM users WHERE id=?', [$uid]);
$samRow = $db->one('SELECT * FROM users WHERE id=?', [$uid2]);
check('history starts private for every account', $db->val('SELECT history_visibility FROM users WHERE id=?', [$uid]) === 'private' && $db->val('SELECT history_visibility FROM users WHERE id=?', [$uid2]) === 'private');
check('nobody is listed while everyone keeps their history private', $auth->historyPeople($samRow) === []);
check('asking for a private history is refused', throws(fn() => $auth->historyOwner($samRow, $uid), 404));
$db->run("UPDATE users SET history_visibility='members' WHERE id=?", [$uid]);
$people = $auth->historyPeople($samRow);
check('once shared, others see the account by display name only', $people === [['id' => $uid, 'name' => 'Mike']], json_encode($people));
check('the account is not listed to itself', $auth->historyPeople($mikeRow) === []);
check('a shared history can be opened', $auth->historyOwner($samRow, $uid)['id'] === $uid);
check('sharing goes one way: the other account stays private', throws(fn() => $auth->historyOwner($mikeRow, $uid2), 404));
$db->run("UPDATE users SET status='pending' WHERE id=?", [$uid]);
check('an account that cannot sign in is not listed', $auth->historyPeople($samRow) === []);
$db->run("UPDATE users SET status='active', history_visibility='private' WHERE id=?", [$uid]);
check('switching back to Only me hides it again', $auth->historyPeople($samRow) === [] && throws(fn() => $auth->historyOwner($samRow, $uid), 404));

echo "Fitbod import\n";
$imp = new FitbodImport($db);
$uid3 = $auth->createUser('importer', 'another long password');
$gym3 = $mkGym($uid3, 'Iron Works', Catalog::equipmentKeys());
$user3 = $db->one('SELECT * FROM users WHERE id=?', [$uid3]);
$parsed = FitbodImport::parse(file_get_contents(__DIR__ . '/fixtures/fitbod-sample.csv'));
check('rows are grouped into workouts by timestamp; cardio-only days drop out', count($parsed['workouts']) === 2 && $parsed['skipped'] === ['Plank' => 1, 'Running' => 1]);
check('a file that is not a Fitbod export is refused', throws(fn() => FitbodImport::parse("a,b,c\n1,2,3\n"), 422));
$plan = $imp->plan($uid3, $parsed);
$byName = array_column($plan, null, 'name');
check('known Fitbod names match built-in exercises', $byName['Barbell Bench Press']['action'] === 'match' && $byName['Barbell Bench Press']['exercise_id'] === $bench && $byName['Pull Up']['action'] === 'match');
check('common Fitbod names that used to need "Add as my own" now match built-ins', $byName['Cable Rope Tricep Extension']['exercise_id'] === $bySlug['cable-rope-triceps-extension'] && $byName['Machine Preacher Curl']['exercise_id'] === $bySlug['machine-preacher-curl'] && $byName['Barbell Shrug']['exercise_id'] === $bySlug['barbell-shrug']);
$unknown = $imp->plan($uid3, ['names' => ['Cable Rope Tricep Flick' => ['sets' => 2, 'weighted' => true]]])[0];
check('unknown names become your own exercises with guessed tags', $unknown['action'] === 'new' && $unknown['guess'] === ['kind' => 'cable', 'equipment' => ['cable'], 'pattern' => 'triceps', 'muscles_main' => ['triceps'], 'muscles_assist' => []]);
check('a machine with no matching gym checkbox is never auto-suggested', FitbodImport::guess('Machine Preacher Curl', true)['pattern'] === 'other' && FitbodImport::guess('Barbell Shrug', true)['pattern'] === 'other');
$targets = array_filter(array_column($plan, 'exercise_id'));
check('no two Fitbod exercises are merged into one built-in', count($targets) === count(array_unique($targets)) && count(array_unique(FitbodImport::MAP)) === count(FitbodImport::MAP));
$missing = array_diff(FitbodImport::MAP, array_column(Catalog::exercises(), 0));
check('every mapped name points at a real catalog exercise', !$missing, implode(' ', $missing));
$res = $imp->run($uid3, $gym3, 'lb', $parsed, $plan);
check('import writes workouts and sets, with every exercise matched', $res === ['workouts' => 2, 'sets' => 11, 'exercises_created' => 0]);
$hist = $wk->history($uid3);
$w = $wk->get($uid3, $hist[0]['id']);
check('kilograms become pounds and warm-ups keep their flag', $w['exercises'][0]['sets'][0] ['weight'] === 45.0 && $w['exercises'][0]['sets'][0]['warmup'] === true && $w['exercises'][0]['sets'][1]['weight'] === 135.0 && $w['exercises'][1]['sets'][0]['weight'] === 25.0);
check('workouts keep their original date', $w['started_at'] === '2026-03-04T18:10:00Z' && $w['day_type'] === 'fitbod');
$blk = $gen->block($user3, $gym3, $exById[$bench]);
check('imported history drives the next suggestion (135 x 10,10,10 -> 140)', $blk['suggested_weight'] === 140.0 && count($blk['previous']['sets']) === 3);
$again = $imp->run($uid3, $gym3, 'lb', $parsed, $imp->plan($uid3, $parsed));
check('importing the same file again replaces rather than duplicates', $again['exercises_created'] === 0 && (int) $db->val('SELECT COUNT(*) FROM workouts WHERE user_id=?', [$uid3]) === 2 && (int) $db->val('SELECT COUNT(*) FROM workout_sets s JOIN workouts w ON w.id=s.workout_id WHERE w.user_id=?', [$uid3]) === 11);
$plan2 = $imp->plan($uid3, $parsed, ['Barbell Shrug' => 'skip', 'Dumbbell Bicep Curl' => (string) $bySlug['hammer-curl']]);
$by2 = array_column($plan2, null, 'name');
check('choices can leave an exercise out or point it at another one', $by2['Barbell Shrug']['action'] === 'skip' && $by2['Dumbbell Bicep Curl']['exercise_id'] === $bySlug['hammer-curl'] && $imp->summary($parsed, $plan2)['sets'] === 10);
$kgRun = $imp->run($uid3, $gym3, 'kg', $parsed, $imp->plan($uid3, $parsed));
$w = $wk->get($uid3, $hist[0]['id']);
check('a kilogram account keeps kilograms', $w['unit'] === 'kg' && $w['exercises'][0]['sets'][1]['weight'] === 61.0);
check('an import does not disturb the split rotation', $gen->nextDayType($uid3, 'ppl') === 'push');
check('one account\'s import is invisible to another', $wk->get($uid, $hist[0]['id']) === null);
check('undo removes only imported workouts', $imp->purge($uid3) === 2 && (int) $db->val('SELECT COUNT(*) FROM workouts WHERE user_id=?', [$uid3]) === 0 && (int) $db->val('SELECT COUNT(*) FROM workouts WHERE user_id=?', [$uid]) > 0);

echo "Sharing a workout\n";
// #36: only the admin can share with the chatgpt account.
$gptId = $auth->createUser('ChatGPT', 'chatgpt-long-password', 'ChatGPT');
$adminSees = array_column($auth->shareTargets($db->one('SELECT * FROM users WHERE id=?', [$uid])), 'id');
$memberSees = array_column($auth->shareTargets($db->one('SELECT * FROM users WHERE id=?', [$uid2])), 'id');
check('the admin can pick the chatgpt account when sharing', in_array($gptId, $adminSees, true) && !in_array($uid, $adminSees, true));
check('a regular user does not see the chatgpt account, but still sees everyone else', !in_array($gptId, $memberSees, true) && in_array($uid, $memberSees, true) && !in_array($uid2, $memberSees, true));
$gptPlan = ['day_type' => 'push', 'exercises' => [['exercise_id' => $bench, 'target_sets' => 3, 'rep_min' => 6, 'rep_max' => 10, 'rest_seconds' => 120]]];
check('the server refuses a share from a regular user to chatgpt', throws(fn() => (new Shares($db))->send($uid2, uuid(), [$gptId], $memberSees, $gptPlan), 422) && (int) $db->val('SELECT COUNT(*) FROM workout_shares WHERE to_user=?', [$gptId]) === 0);
(new Shares($db))->send($uid, uuid(), [$gptId], $adminSees, $gptPlan);
check('the admin can send a share to chatgpt', (int) $db->val('SELECT COUNT(*) FROM workout_shares WHERE to_user=? AND from_user=?', [$gptId, $uid]) === 1);
$db->run('DELETE FROM workout_shares WHERE to_user=?', [$gptId]);
$db->run('DELETE FROM users WHERE id=?', [$gptId]);

$sh = new Shares($db);
$uid3 = $auth->createUser('third', 'third-long-password');
$samRow = $db->one('SELECT * FROM users WHERE id=?', [$uid2]);
$samGym = $mkGym($uid2, 'Sam gym', Catalog::equipmentKeys());
$wk->save($uid2, $doc($samGym, 'push', [[$bench, 5, 8, [[45, 7], [45, 7], [45, 6]]]], $ago(3)));
$customId = $db->insert('exercises', ['user_id' => $uid, 'slug' => 'custom-share-test', 'name' => 'Mike Special Press', 'kind' => 'dumbbell', 'equipment' => '[]', 'pattern' => 'horizontal_push', 'muscles_main' => '["chest"]', 'muscles_assist' => '[]', 'cues' => 'Press it.', 'priority' => 4]);
$line = fn(int $ex, int $sets, int $min, int $max, int $rest) => ['exercise_id' => $ex, 'target_sets' => $sets, 'rep_min' => $min, 'rep_max' => $max, 'rest_seconds' => $rest];
$plan = ['day_type' => 'push', 'exercises' => [$line($bench, 4, 5, 8, 150), $line($customId, 2, 12, 15, 60), $line($bySlug['cable-fly'], 3, 10, 15, 75)]];
$key = uuid();
$allowed = [$uid2, $uid3];
check('a workout cannot be shared with yourself or with someone who has no account', throws(fn() => $sh->send($uid, $key, [$uid], $allowed, $plan), 422) && throws(fn() => $sh->send($uid, $key, [99999], $allowed, $plan), 422));
check('a plan with no usable exercises is refused', throws(fn() => $sh->send($uid, $key, [$uid2], $allowed, ['exercises' => [$line(987654, 3, 8, 12, 90)]]), 422));
$sh->send($uid, $key, [$uid2, $uid3], $allowed, $plan);
$sh->send($uid, $key, [$uid2], $allowed, $plan);
$inc = $sh->incoming($uid2);
$shareId = $inc[0]['id'] ?? 0;
check('the other person sees who shared it and what is in it', count($inc) === 1 && $inc[0]['from_name'] === 'Mike' && $inc[0]['status'] === 'pending' && $inc[0]['exercises'] === ['Barbell Bench Press', 'Mike Special Press', 'Cable Fly'] && $inc[0]['sets'] === 9);
check('it can go to two people at once, and sending twice does not duplicate it', count($sh->incoming($uid3)) === 1 && count($sh->outgoing($uid, $key)) === 2 && $sh->incoming($uid) === []);
check('only the person it was sent to can accept it, and nothing is built before they do', throws(fn() => $sh->accept($uid, $shareId), 404) && throws(fn() => $sh->draft($samRow, $samGym, $shareId, $gen), 404));
// The sender changes the plan, then starts it and changes it again, all before the other person accepts.
$plan['exercises'][2] = $line($bySlug['pec-deck'], 3, 10, 15, 75);
$sh->send($uid, $key, [], $allowed, $plan);
check('a change to the plan before it is accepted reaches the people it was sent to', $sh->incoming($uid2)[0]['exercises'][2] === 'Pec Deck Fly');
$mikeDoc = $doc($big, 'push', [[$bench, 5, 8, [[45, 5, true], [185, 8], [185, 8], [185, 8], [185, 8]]], [$customId, 12, 15, [[30, 12], [30, 12]]], [$bySlug['dumbbell-fly'], 10, 15, [[25, 12], [25, 12], [25, 12]]]], $ago(0), 'active');
$wk->save($uid, $mikeDoc);
$sh->link($uid, $key, $mikeDoc['id']);
$inc = $sh->incoming($uid2);
check('once the sender has started, the share follows their workout as it is now (warm-ups not counted)', $inc[0]['exercises'][2] === 'Dumbbell Fly' && $inc[0]['sets'] === 9);
$sh->accept($uid2, $shareId);
// After the accept, the sender drops an exercise. The accepted copy must not change.
array_pop($mikeDoc['exercises']);
$mikeDoc['rev'] = 2;
$wk->save($uid, $mikeDoc);
$draft = $sh->draft($samRow, $samGym, $shareId, $gen);
$dx = $draft['exercises'];
check('accepting gives the same exercises in the same order', array_column($dx, 'name') === ['Barbell Bench Press', 'Mike Special Press', 'Dumbbell Fly'] && $draft['shared_by'] === 'Mike' && $draft['share_id'] === $shareId);
check('with the same planned sets and rep ranges', array_column($dx, 'target_sets') === [4, 2, 3] && array_column($dx, 'rep_min') === [5, 12, 10] && array_column($dx, 'rep_max') === [8, 15, 15]);
check('the structure is the one in place when it was accepted, not later changes', count($dx) === 3);
$mine = $gen->block($user, $big, $exById[$bench], false, $plan['exercises'][0]);
check('weights are suggested separately for each person (sender ' . $mine['suggested_weight'] . ' lb, partner ' . $dx[0]['suggested_weight'] . ' lb)', $dx[0]['suggested_weight'] === 45.0 && $mine['suggested_weight'] > 100 && $dx[2]['suggested_weight'] === null);
$copy = $db->one('SELECT * FROM exercises WHERE id=?', [$dx[1]['exercise_id']]);
$sh->draft($samRow, $samGym, $shareId, $gen);
check('the sender\'s own exercise is copied into the partner\'s library once', $dx[1]['exercise_id'] !== $customId && (int) $copy['user_id'] === $uid2 && $copy['name'] === 'Mike Special Press' && (int) $db->val("SELECT COUNT(*) FROM exercises WHERE user_id=? AND name='Mike Special Press'", [$uid2]) === 1);
// Both log their own numbers.
$samDoc = $doc($samGym, 'push', [[$bench, 5, 8, [[45, 8], [45, 8], [45, 7], [45, 6]]], [$dx[1]['exercise_id'], 12, 15, [[15, 12], [15, 12]]], [$bySlug['dumbbell-fly'], 10, 15, [[10, 12], [10, 12], [10, 12]]]], $ago(0), 'completed');
$wk->save($uid2, $samDoc);
$sh->markStarted($uid2, $shareId, $samDoc['id']);
$mikeDoc['status'] = 'completed';
$mikeDoc['completed_at'] = $ago(0);
$mikeDoc['rev'] = 3;
$wk->save($uid, $mikeDoc);
$statuses = array_column($sh->outgoing($uid, $key), 'status', 'name');
check('starting it closes the share for that person and shows the sender', $sh->incoming($uid2) === [] && $statuses['sam'] === 'started' && $statuses['third'] === 'pending');
$mw = $wk->get($uid, $mikeDoc['id']);
$sw = $wk->get($uid2, $samDoc['id']);
check('each person has their own history entry with their own numbers', $mw && $sw && $mw['id'] !== $sw['id'] && $mw['exercises'][0]['sets'][1]['weight'] === 185.0 && $sw['exercises'][0]['sets'][0]['weight'] === 45.0 && $wk->get($uid2, $mikeDoc['id']) === null && $wk->get($uid, $samDoc['id']) === null);
$third = $sh->incoming($uid3)[0]['id'];
$sh->decline($uid3, $third);
check('declining removes it for that person and tells the sender', $sh->incoming($uid3) === [] && array_column($sh->outgoing($uid, $key), 'status', 'name')['third'] === 'declined' && throws(fn() => $sh->accept($uid3, $third), 404));
$sh->send($uid, $key, [$uid3], $allowed, $plan);
check('sharing again after a decline puts it back in front of them', count($sh->incoming($uid3)) === 1);
$sh->send($uid, $key, [$uid2], $allowed, $plan);
check('it can be shared again with someone who already trained from it', count($sh->incoming($uid2)) === 1 && $sh->incoming($uid2)[0]['status'] === 'pending');
$db->run('UPDATE workout_shares SET updated_at=? WHERE id=?', [TF\now_utc(time() - 25 * 3600), $third]);
check('a share nobody answers lapses after a day', $sh->incoming($uid3) === [] && array_column($sh->outgoing($uid, $key), 'status', 'name')['third'] === 'expired');

echo "Strava export\n";
$stravaConfig = ['strava' => [
    'client_id' => '1234',
    'client_secret' => 'test-client-secret',
    'callback_url' => 'https://example.com/api.php?a=strava_callback',
]];
$requests = [];
$reply = [201, ['id' => '91234567890123456']];
$overlap = null;
$strava = new Strava($db, $stravaConfig, static function (string $url, ?array $data, ?string $token, ?string $file = null) use (&$requests, &$reply, &$overlap): array {
    $requests[] = [$url, $data, $token, $file];
    if (str_ends_with($url, '/token')) {
        $refresh = $data['grant_type'] === 'refresh_token';
        return [200, [
            'access_token' => $refresh ? 'renewed-access' : 'first-access',
            'refresh_token' => $refresh ? 'renewed-refresh' : 'first-refresh',
            'expires_at' => time() + 3600,
        ]];
    }
    if ($overlap) {
        $overlap();
    }
    return $reply;
});
$session = hash('sha256', 'sign-in session');
$getState = static function () use ($strava, $session, $stravaConfig): string {
    $url = $strava->authorize($session);
    parse_str(parse_url($url, PHP_URL_QUERY), $query);
    check('OAuth requests activity write access at the configured callback',
        parse_url($url, PHP_URL_HOST) === 'www.strava.com' && $query['scope'] === 'activity:write'
        && $query['redirect_uri'] === $stravaConfig['strava']['callback_url']);
    return $query['state'];
};
check('Strava is disabled without deployment credentials', (new Strava($db, []))->connection($uid) === ['enabled' => false, 'connected' => false]);
$oauth = ['state' => $getState(), 'code' => 'test-code', 'scope' => 'read,activity:write'];
check('the OAuth callback cannot be used by another sign-in session', throws(fn() => $strava->connect($uid2, hash('sha256', 'other session'), $oauth), 400) && !$requests);
$strava->connect($uid, $session, $oauth);
check('OAuth state is single-use', throws(fn() => $strava->connect($uid, $session, $oauth), 400) && count($requests) === 1);
check('a connection belongs only to the authorizing ThoeneFit account', $strava->connection($uid)['connected'] && !$strava->connection($uid2)['connected']);
check('tokens are encrypted in the database', !str_contains($db->val('SELECT tokens FROM strava_connections WHERE user_id=?', [$uid]), 'first-refresh'));
check('export cannot read a workout owned by another user', throws(fn() => $strava->export($uid2, $d1['id'], false), 404));

$exportDoc = $doc($home, 'push', [[$bench, 5, 8, [[135, 8], [145, 7]]]], '2026-10-20T16:20:00Z');
$exportDoc['completed_at'] = '2026-10-20T17:00:00Z';
$exportDoc['exercises'][0]['sets'][0]['done_at'] = '2026-10-20T16:35:00Z'; // first and last set 15 and 25 minutes from the ends: not idle
$exportDoc['exercises'][0]['sets'][1]['done'] = false;
$wk->save($uid, $exportDoc);
$exportId = $exportDoc['id'];
$overlap = static function () use ($strava, $uid, $exportId): void {
    check('a concurrent send sees the existing reservation', $strava->export($uid, $exportId, false) === ['activity_id' => null]);
};
$sent = $strava->export($uid, $exportId, false);
$overlap = null;
[$url, $body, $token] = $requests[1];
check('exports a completed lifting workout with its recorded time and elapsed seconds',
    $url === 'https://www.strava.com/api/v3/activities' && $token === 'first-access'
    && $body['name'] === 'Push at ' . $home['name'] && $body['sport_type'] === 'WeightTraining'
    && $body['start_date_local'] === '2026-10-20T16:20:00Z' && $body['elapsed_time'] === 2400);
check('a basic activity sends no exercise details or attachment', !isset($body['description']) && $requests[1][3] === null);
check('retries return the same Strava activity without creating another one', $sent === ['activity_id' => '91234567890123456']
    && $strava->export($uid, $exportId, false) === $sent && count($requests) === 2);

$otherDoc = $exportDoc;
$otherDoc['id'] = uuid();
$otherDoc['exercises'] = [];
$wk->save($uid, $otherDoc);
$db->run('UPDATE strava_connections SET expires_at=0 WHERE user_id=?', [$uid]);
$reply = [429, ['message' => 'Rate limit exceeded']];
check('a definite rejection can be retried and refresh uses the stored refresh token',
    throws(fn() => $strava->export($uid, $otherDoc['id'], false), 409)
    && $strava->exportStatus($uid, $otherDoc['id']) === null && $requests[2][1]['refresh_token'] === 'first-refresh');
$reply = [0, null];
check('an ambiguous response keeps its reservation and cannot create duplicates on retry',
    $strava->export($uid, $otherDoc['id'], false) === ['activity_id' => null]
    && $strava->export($uid, $otherDoc['id'], false) === ['activity_id' => null] && count($requests) === 5);
check('the provider receives no exercise summary unless selected and uses the refreshed token',
    !isset($requests[4][1]['description']) && $requests[4][2] === 'renewed-access');
$otherDoc['id'] = uuid();
$otherDoc['completed_at'] = $otherDoc['started_at'];
$wk->save($uid, $otherDoc);
check('a workout without a measured duration cannot be exported',
    throws(fn() => $strava->export($uid, $otherDoc['id'], false), 422) && count($requests) === 5);

$strengthDoc = $doc($home, 'push', [
    [$bench, 5, 8, [[135, 8], [145, 7, false, false], [155, 6]]],
    [$customId, 5, 8, [[10, 5, true]]],
], '2026-10-20T16:20:00Z');
$strengthDoc['completed_at'] = '2026-10-20T17:00:00Z';
foreach ([[0, 0, '16:31'], [0, 2, '16:44'], [1, 0, '16:55']] as [$e, $n, $hm]) {
    $strengthDoc['exercises'][$e]['sets'][$n]['done_at'] = "2026-10-20T$hm:00Z";
}
$wk->save($uid, $strengthDoc);
$strengthId = $strengthDoc['id'];
$pending = ['activity_id' => null, 'processing' => true];
$reply = [201, ['id_str' => '9223372036854775000', 'activity_id' => null]];
check('acceptance persists a pending upload without confirming an activity', $strava->export($uid, $strengthId, true, -18000) === $pending);
[$url, $form, $token, $file] = $requests[5];
$json = json_decode($file, true, 512, JSON_THROW_ON_ERROR);
check('strength export sends the documented upload fields and preserves title, sport, and timing',
    $url === 'https://www.strava.com/api/v3/uploads' && $token === 'renewed-access'
    && $form['data_type'] === 'json' && $form['external_id'] === 'thoenefit-' . $strengthId
    && $form['name'] === 'Push at ' . $home['name'] && $form['sport_type'] === 'WeightTraining'
    && $json['version'] === '1.0' && $json['start_time'] === '2026-10-20T16:20:00Z'
    && $json['utc_offset'] === -18000 && $json['elapsed_time'] === 2400);
check('structured sets use documented exercise identifiers and kilograms and omit incomplete sets', $json['sets'] === [
    ['exercise_type' => 'BARBELL_BENCH_PRESS', 'repetitions' => 8, 'weight' => 61.235],
    ['exercise_type' => 'BARBELL_BENCH_PRESS', 'repetitions' => 6, 'weight' => 70.307],
]);
check('unmapped sets keep the original exercise name, weight unit and warm-up note in the description',
    $form['description'] === 'Mike Special Press: 5 reps × 10 lb (warm-up)');
check('reopening the history entry and repeating export reuse the pending upload',
    $strava->exportStatus($uid, $strengthId) === $pending && $strava->export($uid, $strengthId, true) === $pending && count($requests) === 6);
check('status checks cannot access a different account or poll the same upload too soon',
    $strava->checkExport($uid2, $strengthId) === null && $strava->checkExport($uid, $strengthId) === $pending && count($requests) === 6);
$due = static fn(string $id) => $db->run('UPDATE strava_exports SET poll_after=0 WHERE user_id=? AND workout_id=?', [$uid, $id]);
$due($strengthId);
$reply = [200, ['activity_id' => null, 'error' => null]];
check('checking an unfinished upload uses its original 64-bit ID and does not create a second activity',
    $strava->checkExport($uid, $strengthId) === $pending
    && $requests[6] === ['https://www.strava.com/api/v3/uploads/9223372036854775000', null, 'renewed-access', null]);
$due($strengthId);
$reply = [200, ['activity_id' => '9223372036854775001', 'error' => null]];
$confirmed = ['activity_id' => '9223372036854775001'];
check('a completed upload records the activity ID and further attempts reuse its receipt',
    $strava->checkExport($uid, $strengthId) === $confirmed && $strava->checkExport($uid, $strengthId) === $confirmed
    && $strava->export($uid, $strengthId, true) === $confirmed && count($requests) === 8);

$fallback = $doc($home, 'push', [[$customId, 5, 8, [[10, 5]]]], '2026-10-20T16:20:00Z');
$fallback['completed_at'] = '2026-10-20T17:00:00Z';
$wk->save($uid, $fallback);
$reply = [201, ['id' => '45']];
check('a workout with only unmapped lifts uses a manual activity with the requested text summary',
    $strava->export($uid, $fallback['id'], true) === ['activity_id' => '45']
    && $requests[8][0] === 'https://www.strava.com/api/v3/activities'
    && $requests[8][1]['description'] === 'Mike Special Press: 5 reps × 10 lb' && $requests[8][3] === null);

$failure = $doc($home, 'push', [[$bench, 5, 8, [[61.5, 8]]]], '2026-10-20T16:20:00Z');
$failure['unit'] = 'kg';
$failure['completed_at'] = '2026-10-20T17:00:00Z';
$wk->save($uid, $failure);
$failureId = $failure['id'];
$reply = [201, ['id' => '123']];
$strava->export($uid, $failureId, true);
check('already-metric workouts keep their logged weight', json_decode($requests[9][3], true)['sets'][0]['weight'] === 61.5);
$due($failureId);
$reply = [503, null];
check('a transient response keeps the upload pending', $strava->checkExport($uid, $failureId) === $pending);
$due($failureId);
$reply = [200, ['activity_id' => null, 'error' => 'Invalid file']];
check('a rejected upload can be corrected and sent again', $strava->checkExport($uid, $failureId) === null && $strava->exportStatus($uid, $failureId) === null);
$reply = [201, ['id' => '124']];
$strava->export($uid, $failureId, true);
$due($failureId);
$reply = [200, ['activity_id' => null, 'error' => 'Duplicate of activity 111']];
check('a reported duplicate cannot be posted again',
    $strava->checkExport($uid, $failureId) === ['activity_id' => null] && $strava->export($uid, $failureId, true) === ['activity_id' => null]
    && count($requests) === 14);
// #49: a workout left open overnight is sent with its idle time removed.
$nightDoc = $doc($home, 'push', [[$bench, 5, 8, [[135, 8], [135, 8]]]], '2026-10-21T00:00:00Z');
$nightDoc['exercises'][0]['sets'][0]['done_at'] = '2026-10-21T00:12:00Z';
$nightDoc['exercises'][0]['sets'][1]['done_at'] = '2026-10-21T00:41:00Z';
$nightDoc['completed_at'] = '2026-10-21T14:00:00Z'; // finished the next morning
$wk->save($uid, $nightDoc);
$reply = [201, ['id' => '91234567890123499']];
$strava->export($uid, $nightDoc['id'], false);
$nightBody = end($requests)[1];
check('a workout left open overnight goes to Strava as the time actually trained (46 minutes, not 14 hours)',
    $nightBody['start_date_local'] === '2026-10-21T00:00:00Z' && $nightBody['elapsed_time'] === 46 * 60, json_encode([$nightBody['start_date_local'] ?? null, $nightBody['elapsed_time'] ?? null]));

// #87: "Send to Strava" ticked on the Finish sheet travels with the workout and is
// sent by the save that finishes it.
$finishDoc = $doc($home, 'push', [[$bench, 5, 8, [[135, 8], [135, 8]]]], '2026-10-22T16:00:00Z', 'active');
$finishDoc['exercises'][0]['sets'][0]['done_at'] = '2026-10-22T16:10:00Z';
$finishDoc['exercises'][0]['sets'][1]['done_at'] = '2026-10-22T16:40:00Z';
check('saving a workout in progress does not count as finishing it', $wk->save($uid, $finishDoc)['completed_now'] === false);
$finishDoc['status'] = 'completed';
$finishDoc['completed_at'] = '2026-10-22T16:45:00Z';
$finishDoc['rev'] = 2;
$finishDoc['strava_send'] = ['include_summary' => false, 'utc_offset' => -21600];
$finished = $wk->save($uid, $finishDoc);
$before = count($requests);
$reply = [201, ['id' => '87000000000000001']];
$onFinish = $strava->sendOnFinish($uid, $finishDoc['id'], $finishDoc['strava_send'], $finished['completed_now']);
check('the save that finishes a workout sends it to Strava once',
    $finished['completed_now'] === true && $onFinish === ['activity_id' => '87000000000000001'] && count($requests) === $before + 1
    && end($requests)[0] === 'https://www.strava.com/api/v3/activities');
$again = $wk->save($uid, $finishDoc);
check('repeating that save (a retry, or an edit later) does not send it again',
    $again['completed_now'] === false && $strava->sendOnFinish($uid, $finishDoc['id'], $finishDoc['strava_send'], $again['completed_now']) === null
    && count($requests) === $before + 1);

$plainDoc = $doc($home, 'push', [[$bench, 5, 8, [[135, 8]]]], '2026-10-23T16:00:00Z');
$plainDoc['completed_at'] = '2026-10-23T16:30:00Z';
$plain = $wk->save($uid, $plainDoc);
check('a workout finished offline and synced for the first time counts as finished',  $plain['completed_now'] === true);
check('finishing with Send to Strava unticked sends nothing',
    $strava->sendOnFinish($uid, $plainDoc['id'], $plainDoc['strava_send'] ?? null, $plain['completed_now']) === null && count($requests) === $before + 1);
check('someone not connected to Strava sends nothing',
    $strava->sendOnFinish($uid2, $plainDoc['id'], ['include_summary' => false], true) === null && count($requests) === $before + 1);

$rejectDoc = $doc($home, 'push', [[$bench, 5, 8, [[135, 8]]]], '2026-10-24T16:00:00Z');
$rejectDoc['completed_at'] = '2026-10-24T16:30:00Z';
$rejected = $wk->save($uid, $rejectDoc);
$reply = [429, ['message' => 'Rate limit exceeded']];
$logged = ini_set('error_log', '/dev/null');
$onFinish = $strava->sendOnFinish($uid, $rejectDoc['id'], ['include_summary' => true, 'utc_offset' => 0], $rejected['completed_now']);
ini_set('error_log', $logged === false ? '' : $logged);
check('when Strava refuses, the workout stays saved and can be sent again from History',
    $onFinish === null && $wk->get($uid, $rejectDoc['id'])['status'] === 'completed' && $strava->exportStatus($uid, $rejectDoc['id']) === null);
$reply = [201, ['id' => '87000000000000002']];
check('sending it again by hand afterwards works', $strava->export($uid, $rejectDoc['id'], false) === ['activity_id' => '87000000000000002']);

check('disconnect removes credentials and preserves the export receipt',
    !$strava->disconnect($uid)['connected'] && $strava->exportStatus($uid, $exportId) === $sent);

echo "Feedback as GitHub issues\n";
$vf = sys_get_temp_dir() . '/tf-version-' . getmypid() . '.json';
file_put_contents($vf, '{"build":"abc123","version":"0.1.110-staging"}');
check('the app version comes from the version the deploy stamped', \TF\app_version($vf) === '0.1.110-staging');
file_put_contents($vf, '{"build":"dev"}');
check('a copy that was never deployed says dev, not a made-up number', \TF\app_version($vf) === 'dev' && \TF\app_version('/nonexistent/version.json') === 'dev');
file_put_contents($vf, '{"version":"<script>"}');
check('a garbled version file is not trusted', \TF\app_version($vf) === 'dev');
@unlink($vf);
check('the server no longer has a hard-coded app version', !defined('TF\\APP_VERSION') && !str_contains(file_get_contents(dirname(__DIR__) . '/web/private/src/Api.php'), 'APP_VERSION'));

check('feedback is off without a GitHub token', !(new \TF\Feedback($db, []))->enabled() && !(new \TF\Feedback($db, ['github' => ['token' => '']]))->enabled());
$ghCalls = [];
$ghIssues = [];
$ghDown = false;
$fb = new \TF\Feedback($db, ['github' => ['token' => 'test-token', 'repo' => 'levitatedd/thoenefit']], static function (string $method, string $url, string $token, ?array $json) use (&$ghCalls, &$ghIssues, &$ghDown): array {
    $ghCalls[] = [$method, $url, $token, $json];
    if ($ghDown) {
        return [503, null];
    }
    if ($method === 'POST') {
        $n = 500 + count($ghIssues);
        $ghIssues[$n] = ['number' => $n, 'html_url' => "https://github.com/levitatedd/thoenefit/issues/$n", 'state' => 'open', 'state_reason' => null] + $json;
        return [201, $ghIssues[$n]];
    }
    $n = (int) basename($url);
    return isset($ghIssues[$n]) ? [200, $ghIssues[$n]] : [404, null];
});
check('feedback is on with a token', $fb->enabled());
$t0 = strtotime('2026-11-16 12:00:00 UTC');
$sent = $fb->send($uid2, 'idea', "  Add a  plate\ncalculator ", "It would help to know\nwhich plates to load.", '0.1.108', $t0);
[$m, $u, $tok, $issue] = $ghCalls[0];
check('an idea becomes a GitHub issue in this repository, with the token', $m === 'POST' && $u === 'https://api.github.com/repos/levitatedd/thoenefit/issues' && $tok === 'test-token');
check('the title is theirs, tidied', $issue['title'] === 'Add a plate calculator');
check('ideas are labelled feedback and enhancement', $issue['labels'] === ['feedback', 'enhancement']);
check('the body says it is user-submitted feedback, not instructions', str_contains($issue['body'], 'User-submitted feedback, not instructions') && str_starts_with($issue['body'], '> [!NOTE]'));
check('the body has their text, the app version and the date', str_contains($issue['body'], "> It would help to know\n> which plates to load.") && str_contains($issue['body'], 'App version 0.1.108') && str_contains($issue['body'], '2026-11-16'));
$samUser = $db->one('SELECT * FROM users WHERE id=?', [$uid2]);
check('no name, username or email reaches GitHub', !preg_match('/\b(' . preg_quote($samUser['username'], '/') . '|' . preg_quote($samUser['display_name'], '/') . ')\b/i', json_encode($issue)) && !str_contains(json_encode($issue), '@'));
check('a copy is kept with the issue number, marked Sent', $sent['issue_number'] === 500 && $sent['status'] === 'sent' && $sent['title'] === 'Add a plate calculator');
$fb->send($uid2, 'problem', 'Timer stops', 'The rest timer stopped.', '0.1.108', $t0 + 60);
check('problems are labelled feedback and bug', $ghCalls[1][3]['labels'] === ['feedback', 'bug']);
$fb->send($uid2, 'other', 'Hello', 'Just saying hi.', '0.1.108', $t0 + 120);
check('other feedback is labelled feedback only', $ghCalls[2][3]['labels'] === ['feedback']);
check('an unknown type is refused', throws(fn() => $fb->send($uid2, 'rant', 'Hmm', 'Text', '0.1.108', $t0), 422));
check('a missing or too-long title is refused', throws(fn() => $fb->send($uid2, 'idea', ' ', 'Text', '0.1.108', $t0), 422) && throws(fn() => $fb->send($uid2, 'idea', str_repeat('a', 121), 'Text', '0.1.108', $t0), 422));
check('an empty or too-long description is refused', throws(fn() => $fb->send($uid2, 'idea', 'Title', '  ', '0.1.108', $t0), 422) && throws(fn() => $fb->send($uid2, 'idea', 'Title', str_repeat('a', 4001), '0.1.108', $t0), 422));
$ghDown = true;
$before = count($ghIssues);
check('when GitHub cannot be reached it says so and keeps nothing', throws(fn() => $fb->send($uid2, 'idea', 'Later', 'Text', '0.1.108', $t0 + 180), 502) && (int) $db->val('SELECT COUNT(*) FROM feedback WHERE user_id=?', [$uid2]) === 3);
$ghDown = false;
$fb->send($uid2, 'idea', 'Four', 'Text', '0.1.108', $t0 + 240);
$fb->send($uid2, 'idea', 'Five', 'Text', '0.1.108', $t0 + 300);
check('a person can send at most 5 a day', throws(fn() => $fb->send($uid2, 'idea', 'Six', 'Text', '0.1.108', $t0 + 360), 429));
check('others are not held back by that limit', $fb->send($uid, 'idea', 'Mine', 'Text', '0.1.108', $t0 + 360)['status'] === 'sent');
check('the next day they can send again', $fb->send($uid2, 'idea', 'Next day', 'Text', '0.1.108', $t0 + 86400 + 1)['status'] === 'sent');
$mine = $fb->mine($uid2, $t0 + 86400 + 2);
check('each person sees only what they sent, newest first', count($mine) === 6 && $mine[0]['title'] === 'Next day' && !in_array('Mine', array_column($mine, 'title'), true));
$ghIssues[500]['state'] = 'closed';
$ghIssues[500]['state_reason'] = 'completed';
$ghIssues[501]['state'] = 'closed';
$ghIssues[501]['state_reason'] = 'not_planned';
$calls = count($ghCalls);
$fb->mine($uid2, $t0 + 86400 + 10);
check('statuses are cached for a few minutes', count($ghCalls) === $calls);
$byTitle = array_column($fb->mine($uid2, $t0 + 86400 + 400), 'status', 'title');
check('closed as completed shows Done, closed otherwise shows Closed, open shows Sent', $byTitle['Add a plate calculator'] === 'done' && $byTitle['Timer stops'] === 'closed' && $byTitle['Hello'] === 'sent', json_encode($byTitle));
$ghDown = true;
check('if GitHub is down the last known status is kept', array_column($fb->mine($uid2, $t0 + 86400 * 2), 'status', 'title')['Add a plate calculator'] === 'done');
$ghDown = false;
$all = $fb->all($t0 + 86400 * 2);
check('the admin list shows everything with who sent it', count($all) === 7 && in_array('sam', array_column($all, 'username'), true) && isset($all[0]['from']));

echo "Saved routines\n";
$rt = new TF\Routines($db);
$rtPlan = ['day_type' => 'push', 'exercises' => [
    ['exercise_id' => $bench, 'target_sets' => 4, 'rep_min' => 5, 'rep_max' => 8, 'rest_seconds' => 150],
    ['exercise_id' => $bySlug['cable-fly'], 'target_sets' => 3, 'rep_min' => 10, 'rep_max' => 15, 'rest_seconds' => 60],
    ['exercise_id' => 987654, 'target_sets' => 3, 'rep_min' => 8, 'rep_max' => 12, 'rest_seconds' => 90],
]];
check('a routine needs a name and at least one usable exercise', throws(fn() => $rt->save($uid, '  ', $rtPlan), 422) && throws(fn() => $rt->save($uid, 'Empty', ['exercises' => [['exercise_id' => 987654]]]), 422));
$first = $rt->save($uid, ' Monday   Push ', $rtPlan);
$mine = $rt->all($uid);
check('saving keeps the name tidy and drops exercises that do not exist', !$first['replaced'] && count($mine) === 1 && $mine[0]['name'] === 'Monday Push' && $mine[0]['exercises'] === ['Barbell Bench Press', 'Cable Fly'] && $mine[0]['sets'] === 7);
$again = $rt->save($uid, 'monday push', ['day_type' => 'push', 'exercises' => [$rtPlan['exercises'][0]]]);
check('saving under a name already used replaces that routine instead of adding another', $again['replaced'] && $again['id'] === $first['id'] && count($rt->all($uid)) === 1 && $rt->all($uid)[0]['sets'] === 4);
$rt->save($uid, 'Monday Push', $rtPlan);
check('routines are private to each account', $rt->all($uid2) === [] && throws(fn() => $rt->delete($uid2, $first['id']), 404) && throws(fn() => $rt->draft($samRow ?? $db->one('SELECT * FROM users WHERE id=?', [$uid2]), $big, $first['id'], $gen), 404));
$rtDraft = $rt->draft($user, $big, $first['id'], $gen);
$rx = $rtDraft['exercises'];
check('starting a routine gives its exercises, order, sets and rep ranges', $rtDraft['routine_name'] === 'Monday Push' && array_column($rx, 'name') === ['Barbell Bench Press', 'Cable Fly'] && array_column($rx, 'target_sets') === [4, 3] && array_column($rx, 'rep_min') === [5, 10] && array_column($rx, 'rest_seconds') === [150, 60]);
check('with the last logged weight and reps for reference, and a weight suggested from history', $rx[0]['previous'] !== null && count($rx[0]['previous']['sets']) > 0 && $rx[0]['suggested_weight'] !== null && strpos($rx[0]['reason'], 'From your routine Monday Push') === 0);
$rtHome = $rt->draft($user, $home, $first['id'], $gen);
check('an exercise the gym may not have equipment for is kept, with a note', count($rtHome['exercises']) === 2 && strpos($rtHome['exercises'][1]['reason'], 'may not have the equipment') !== false);
$second = $rt->save($uid, 'Leg Day', ['day_type' => 'legs', 'exercises' => [['exercise_id' => $bySlug['back-squat'], 'target_sets' => 5, 'rep_min' => 3, 'rep_max' => 5, 'rest_seconds' => 180]]]);
check('renaming works, but not to a name another routine already has', throws(fn() => $rt->rename($uid, $second['id'], 'MONDAY PUSH'), 409) && (function () use ($rt, $uid, $second) { $rt->rename($uid, $second['id'], 'Squat Day'); return in_array('Squat Day', array_column($rt->all($uid), 'name'), true); })());
$db->run('UPDATE routines SET updated_at=? WHERE id=?', [TF\now_utc(time() - 3600), $second['id']]); // saved an hour ago
$db->run('UPDATE routines SET updated_at=? WHERE id=?', [TF\now_utc(time() - 7200), $first['id']]);
check('otherwise the most recently saved is listed first', $rt->all($uid)[0]['name'] === 'Squat Day');
$rt->markUsed($uid, $first['id']);
check('the routine used most recently is listed first', $rt->all($uid)[0]['name'] === 'Monday Push');
$rt->delete($uid, $second['id']);
check('a routine can be deleted', array_column($rt->all($uid), 'name') === ['Monday Push'] && throws(fn() => $rt->draft($user, $big, $second['id'], $gen), 404));
$rt->delete($uid, $first['id']);

echo "Idle time in workout durations\n";
$span = fn(...$a) => TF\Workouts::activeSpan(...$a);
$len = fn(?array $s) => $s === null ? null : $s['end'] - $s['start'];
check('a normal workout keeps its full start-to-finish time', $len($span('2026-11-01 10:00:00', '2026-11-01 11:00:00', '2026-11-01 10:08:00', '2026-11-01 10:52:00')) === 3600);
check('gaps of exactly 30 minutes are not treated as idle', $len($span('2026-11-01 10:00:00', '2026-11-01 11:30:00', '2026-11-01 10:30:00', '2026-11-01 11:00:00')) === 5400);
$night = $span('2026-11-01 23:00:00', '2026-11-02 13:00:00', '2026-11-01 23:05:00', '2026-11-01 23:50:00');
check('finished the next morning: counted to 5 minutes after the last set', $len($night) === 55 * 60 && $night['start'] === strtotime('2026-11-01 23:00:00 UTC'));
$early = $span('2026-11-01 06:00:00', '2026-11-01 11:00:00', '2026-11-01 10:00:00', '2026-11-01 10:50:00');
check('started hours before the first set: counted from 5 minutes before it', $len($early) === 65 * 60 && $early['start'] === strtotime('2026-11-01 09:55:00 UTC'));
check('both ends idle: only the training in the middle counts', $len($span('2026-11-01 06:00:00', '2026-11-01 20:00:00', '2026-11-01 10:00:00', '2026-11-01 10:30:00')) === 40 * 60);
check('one set logged long after starting and finished long after: about 10 minutes', $len($span('2026-11-01 06:00:00', '2026-11-01 20:00:00', '2026-11-01 10:00:00', '2026-11-01 10:00:00')) === 10 * 60);
check('no set times (or start equal to finish, as in Fitbod imports) behave as before', $len($span('2026-11-01 10:00:00', '2026-11-01 10:40:00')) === 2400 && $span('2026-11-01 10:00:00', '2026-11-01 10:00:00', '2026-11-01 10:00:00', '2026-11-01 10:00:00') === null);
check('ISO and stored UTC times read the same, whatever the server timezone', (function () use ($len, $span) {
    $tz = date_default_timezone_get();
    date_default_timezone_set('America/Chicago');
    $a = $span('2026-11-01T23:00:00Z', '2026-11-02T13:00:00Z', '2026-11-01 23:05:00', '2026-11-01 23:50:00');
    date_default_timezone_set($tz);
    return $len($a) === 55 * 60 && $a['start'] === strtotime('2026-11-01T23:00:00Z');
})());

echo "Pausing a workout\n";
check('paused time is taken off the training time', $span('2026-11-01 10:00:00', '2026-11-01 11:00:00', '2026-11-01 10:05:00', '2026-11-01 10:55:00', 600)['seconds'] === 3000);
check('without a pause, training time is start to finish as before', $span('2026-11-01 10:00:00', '2026-11-01 11:00:00', '2026-11-01 10:05:00', '2026-11-01 10:55:00')['seconds'] === 3600);
check('a pause as long as the whole workout leaves no duration', $span('2026-11-01 10:00:00', '2026-11-01 10:10:00', null, null, 600) === null);
$pauser = $auth->createUser('pauser', 'pauser long password');
$pd = $doc($big, 'push', [[$bench, 6, 10, [[135, 8]]]], '2026-11-01T10:00:00Z', 'active');
$pd['paused_s'] = 300;
$pd['paused_at'] = '2026-11-01T10:30:00Z';
$wk->save($pauser, $pd);
$got = $wk->get($pauser, $pd['id']);
check('a paused workout keeps its pause on the server, for other devices', $got['paused_s'] === 300 && $got['paused_at'] === '2026-11-01T10:30:00Z' && count($got['exercises'][0]['sets']) === 1);
$pd['paused_at'] = null;
$pd['paused_s'] = 900;
$pd['rev'] = 2;
$wk->save($pauser, $pd);
$got = $wk->get($pauser, $pd['id']);
check('resuming clears the pause and keeps the total', $got['paused_s'] === 900 && $got['paused_at'] === null);
$pd['paused_at'] = '2026-11-01T10:40:00Z';
$pd['status'] = 'completed';
$pd['completed_at'] = '2026-11-01T10:45:00Z';
$pd['exercises'][0]['sets'][0]['done_at'] = '2026-11-01T10:20:00Z';
$pd['rev'] = 3;
$wk->save($pauser, $pd);
$got = $wk->get($pauser, $pd['id']);
check('finishing while paused counts the pause up to the finish', $got['paused_s'] === 1200 && $got['paused_at'] === null && $got['status'] === 'completed');
check('the workout duration leaves out the paused time', TF\Workouts::workoutSpan($got)['seconds'] === 2700 - 1200);
check('junk pause values are ignored', (function () use ($wk, $pauser, $doc, $big, $bench) {
    $j = $doc($big, 'push', [[$bench, 6, 10, [[135, 8]]]], '2026-11-02T10:00:00Z', 'active');
    $j['paused_s'] = -50;
    $j['paused_at'] = 'not a time';
    $wk->save($pauser, $j);
    $g = $wk->get($pauser, $j['id']);
    $wk->delete($pauser, $j['id']);
    return $g['paused_s'] === 0 && $g['paused_at'] === null;
})());
$wk->delete($pauser, $pd['id']);
$db->run('DELETE FROM users WHERE id=?', [$pauser]);

echo "Weekly training trends\n";
$trendsUid = $auth->createUser('trends-user', 'trends-user-123');
$trendsGym = $mkGym($trendsUid, 'Trends gym', ['barbell', 'bench']);
$sunday = $doc($trendsGym, 'push', [[$bench, 6, 10, [[50, 3], [40, 10, true], [100, 10, false, false]]]], '2026-11-02T04:30:00Z');
$sunday['completed_at'] = '2026-11-02T05:10:00Z';
$sunday['exercises'][0]['sets'][0]['done_at'] = '2026-11-02T04:58:00Z';
$sunday['exercises'][0]['sets'][1]['done_at'] = '2026-11-02T04:41:00Z';
$wk->save($trendsUid, $sunday);
$monday = $doc($trendsGym, 'push', [[$bench, 6, 10, [[10, 10]]]], '2026-11-02T06:30:00Z');
$monday['unit'] = 'kg';
$wk->save($trendsUid, $monday); // Start and finish are equal, as with older imports without a duration.
$emptySets = $doc($trendsGym, 'custom', [], '2026-11-03T06:30:00Z');
$emptySets['completed_at'] = '2026-11-03T06:55:00Z';
$wk->save($trendsUid, $emptySets);
$wk->save($trendsUid, $doc($trendsGym, 'push', [[$bench, 6, 10, [[100, 10]]]], '2026-11-03T08:00:00Z', 'active'));
$wk->save($uid, $doc($big, 'push', [[$bench, 6, 10, [[100, 10]]]], '2026-11-03T08:00:00Z'));
$weeks = $wk->weeklyTrends($trendsUid, 'lb', 'America/Chicago', strtotime('2026-11-04T12:00:00Z'));
check('trends use local Monday boundaries and include eight weeks with empty weeks', count($weeks) === 8 &&
    $weeks[0]['volume'] === 0.0 && $weeks[0]['seconds'] === null &&
    $weeks[6]['start'] === '2026-10-26' && $weeks[7]['start'] === '2026-11-02');
check('weekly volume excludes warm-ups, unfinished sets, active workouts, and other accounts',
    $weeks[6]['volume'] === 150.0 && abs($weeks[7]['volume'] - 220.462262) < 0.00001 &&
    $weeks[6]['workouts'] === 1 && $weeks[7]['workouts'] === 2);
$idleUid = $auth->createUser('idle-user', 'idle-user-12345');
$idleGym = $mkGym($idleUid, 'Idle gym', ['barbell', 'bench']);
$overnight = $doc($idleGym, 'push', [[$bench, 6, 10, [[100, 10], [100, 9]]]], '2026-11-03T00:00:00Z'); // Mon 6 pm Chicago
$overnight['exercises'][0]['sets'][0]['done_at'] = '2026-11-03T00:10:00Z';
$overnight['exercises'][0]['sets'][1]['done_at'] = '2026-11-03T00:40:00Z';
$overnight['completed_at'] = '2026-11-03T14:00:00Z';
$wk->save($idleUid, $overnight);
$marathon = $doc($idleGym, 'push', [[$bench, 6, 10, [[100, 10], [100, 9]]]], '2026-11-04T12:00:00Z'); // sets really spread over 5 hours
$marathon['exercises'][0]['sets'][0]['done_at'] = '2026-11-04T12:10:00Z';
$marathon['exercises'][0]['sets'][1]['done_at'] = '2026-11-04T16:55:00Z';
$marathon['completed_at'] = '2026-11-04T17:00:00Z';
$wk->save($idleUid, $marathon);
$idleWeeks = $wk->weeklyTrends($idleUid, 'lb', 'America/Chicago', strtotime('2026-11-05T12:00:00Z'));
check('Trends counts a workout left open overnight as 45 minutes, not 14 hours', $idleWeeks[7]['workouts'] === 2 && $idleWeeks[7]['seconds'] === 45 * 60, json_encode($idleWeeks[7]));
check('a workout still over 4 hours after removing idle time is left out of weekly time, but its volume counts', $idleWeeks[7]['volume'] === 3800.0);
check('weekly elapsed time counts each recorded duration once and leaves untimed imports out',
    $weeks[6]['seconds'] === 2400 && $weeks[7]['seconds'] === 1500);

echo "Cardio warm-ups\n";
$cUid = $auth->createUser('cardio-user', 'cardio-user-123');
$cUser = $db->one('SELECT * FROM users WHERE id=?', [$cUid]);
$cGym = $mkGym($cUid, 'Cardio gym', ['barbell', 'bench', 'rack', 'dumbbells', 'stationary_bike', 'elliptical', 'treadmill']);
$noCardioGym = $mkGym($cUid, 'No cardio gym', ['barbell', 'bench', 'rack', 'dumbbells']);
$cardioEx = array_filter(Catalog::exercises(), static fn($e) => $e[2] === 'cardio');
check('five cardio machines, each needing its checkbox, listing no muscles', count($cardioEx) === 5 && !array_filter($cardioEx, static fn($e) => $e[4] !== 'cardio' || $e[5] || $e[6] || count($e[3]) !== 1));
$plain = $gen->generate($cUser, $cGym, ['day_type' => 'push', 'now' => strtotime('2026-11-10T12:00:00Z')]);
check('without the option, no cardio is ever picked for the workout', !array_filter($plain['exercises'], static fn($b) => $b['kind'] === 'cardio') && $plain['warm_up'] === false && $plain['warm_up_available'] === true);
$warm = $gen->generate($cUser, $cGym, ['day_type' => 'push', 'warm_up' => true, 'now' => strtotime('2026-11-10T12:00:00Z')]);
$first = $warm['exercises'][0];
check('with it, the workout starts with 10 minutes on a cardio machine the gym has (' . $first['name'] . ')', $warm['warm_up'] === true && $first['slot'] === 'warmup' && $first['kind'] === 'cardio' && $first['target_seconds'] === 600 && $first['name'] === 'Stationary Bike' && $first['target_sets'] === 1 && $first['rest_seconds'] === 0);
check('the warm-up counts toward the planned time, and the lifts start the same as without it', $warm['est_minutes'] === (int) round(array_sum(array_column($warm['exercises'], 'minutes'))) && $warm['est_minutes'] <= $warm['minutes'] && array_column(array_slice($warm['exercises'], 1, 3), 'exercise_id') === array_column(array_slice($plain['exercises'], 0, 3), 'exercise_id'));
$none = $gen->generate($cUser, $noCardioGym, ['day_type' => 'push', 'warm_up' => true]);
$leadOf = static fn($plan) => array_values(array_filter($plan['exercises'], static fn($b) => $b['kind'] !== 'stretch' || $b['pattern'] !== 'dynamic_stretch' ? false : true));
check('a gym with no cardio machine still offers a warm-up: dynamic stretches instead of a machine', $none['warm_up'] === true && $none['warm_up_available'] === true && $none['warm_up_kind'] === 'stretches'
    && !in_array('cardio', array_column($none['exercises'], 'kind'), true) && $none['exercises'][0]['pattern'] === 'dynamic_stretch' && in_array(count($leadOf($none)), [2, 3], true));
$bw = $gen->generate($cUser, $cGym, ['day_type' => 'push', 'warm_up' => true, 'bodyweight_only' => true]);
check('bodyweight-only workouts get no machine, but warm up with 2 or 3 dynamic stretches (#138)', $bw['warm_up'] === true && $bw['warm_up_available'] === true && !in_array('cardio', array_column($bw['exercises'], 'kind'), true)
    && $bw['exercises'][0]['pattern'] === 'dynamic_stretch' && in_array(count($leadOf($bw)), [2, 3], true) && !in_array('static_stretch', array_column($bw['exercises'], 'pattern'), true));
$bwOff = $gen->generate($cUser, $cGym, ['day_type' => 'push', 'bodyweight_only' => true]);
check('with the box unticked, bodyweight-only workouts have no warm-up', $bwOff['warm_up'] === false && !in_array('stretch', array_column($bwOff['exercises'], 'kind'), true));
check('with a machine, the warm-up is still the machine and no stretches unless asked', $warm['warm_up_kind'] === 'cardio' && !in_array('stretch', array_column($warm['exercises'], 'kind'), true));
$ellip = $bySlug['elliptical'];
$bike = $bySlug['stationary-bike'];
$cardioDoc = $doc($cGym, 'push', [[$bench, 6, 10, [[135, 8]]]], '2026-11-08T17:00:00Z');
array_unshift($cardioDoc['exercises'], ['id' => uuid(), 'exercise_id' => $ellip, 'rep_min' => 1, 'rep_max' => 1, 'target_sets' => 1, 'target_seconds' => 600,
    'sets' => [['id' => uuid(), 'weight' => null, 'reps' => null, 'duration_s' => 745, 'distance_m' => 2414.0, 'level' => 8, 'done' => true, 'done_at' => '2026-11-08T17:12:00Z']]]);
$wk->save($cUid, $cardioDoc);
$saved = $wk->get($cUid, $cardioDoc['id']);
$cs = $saved['exercises'][0]['sets'][0];
check('a cardio set saves its time, distance and level, and the plan its target time', $cs['duration_s'] === 745 && $cs['distance_m'] === 2414.0 && $cs['level'] === 8.0 && $cs['weight'] === null && $cs['reps'] === null && $saved['exercises'][0]['target_seconds'] === 600);
$again = $gen->generate($cUser, $cGym, ['day_type' => 'push', 'warm_up' => true, 'now' => strtotime('2026-11-10T12:00:00Z')])['exercises'][0];
check('next time it picks the machine used last and its time, to the minute (12:25 -> 12 min)', $again['exercise_id'] === $ellip && $again['target_seconds'] === 720 && $again['previous']['sets'][0]['level'] === 8.0 && str_contains($again['reason'], 'same as last time'));
$locked = $gen->generate($cUser, $cGym, ['day_type' => 'push', 'warm_up' => true, 'locked' => ['warmup' => $bike], 'avoid' => [$ellip]])['exercises'][0];
check('a swapped-in warm-up is kept when the plan changes', $locked['exercise_id'] === $bike && $locked['locked'] === true);
$regen = $gen->generate($cUser, $cGym, ['day_type' => 'push', 'warm_up' => true, 'avoid' => [$ellip]])['exercises'][0];
check('Regenerate keeps the same warm-up machine', $regen['exercise_id'] === $ellip);
$alts = array_column($gen->alternatives($cUid, $cGym, $bike), 'exercise_id');
check('swapping a warm-up offers only the other cardio machines at the gym', $alts && !array_diff($alts, [$ellip, $bySlug['treadmill']]) && !in_array($bySlug['rowing-machine'], $alts, true));
$strengthAlts = array_column($gen->alternatives($cUid, $cGym, $bench), 'exercise_id');
check('swapping a lift never offers a cardio machine', !array_intersect($strengthAlts, [$bike, $ellip, $bySlug['treadmill']]));
check('a shared plan with a warm-up gives the recipient a cardio block too', $gen->block($cUser, $cGym, $exById[$bike], false, ['target_sets' => 1, 'rep_min' => 1, 'rep_max' => 1, 'rest_seconds' => 0])['target_seconds'] === 600);
$cHist = $wk->history($cUid);
check('History counts lifting sets and volume only', $cHist[0]['sets'] === 1 && $cHist[0]['volume'] == 1080 && $cHist[0]['exercises'][0] === 'Elliptical');
check('recovery and weekly sets ignore cardio', $gen->muscleStats($cUid, strtotime('2026-11-08T18:00:00Z'))['quads']['weekly_sets'] == 0);
check('the warm-up is never used for weight suggestions', $gen->lastPerformance($cUid, (string) $ellip) === null);
$eh = $wk->exerciseHistory($cUid, $ellip);
check('the elliptical history lists time, distance and level', count($eh) === 1 && $eh[0]['sets'][0] === ['duration_s' => 745, 'distance_m' => 2414.0, 'level' => 8.0]);
$cWeeks = $wk->weeklyTrends($cUid, 'lb', 'America/Chicago', strtotime('2026-11-10T12:00:00Z'));
check('weekly volume ignores cardio', $cWeeks[7]['volume'] == 0 && $cWeeks[6]['volume'] == 1080.0);
$fh = fopen('php://memory', 'w+');
$wk->exportCsv($cUid, $fh);
rewind($fh);
$csvOut = stream_get_contents($fh);
check('CSV export has time, distance and level', str_contains($csvOut, ',seconds,distance_m,level') && str_contains($csvOut, ',745,2414,8'));
$stravaDetails = TF\StravaStrength::details($saved);
check('Strava gets the warm-up in the description and the lifts as sets', str_contains($stravaDetails['description'], 'Elliptical: 12.4 min, 1.5 mi, level 8') && count($stravaDetails['sets']) === 1);
$fitbodCsv = "Date,Exercise,Reps,Weight(kg),Duration(s),Distance(m),Incline,Resistance,isWarmup,Note,multiplier\n"
    . "2025-11-06 19:23:18 +0000,Cycling - Stationary, 0,0.0,300.0,2607.1,0.0,12.0,false,, 1.0\n"
    . "2025-11-06 19:23:18 +0000,Barbell Bench Press, 8,60.0,0.0,0.0,0.0,0.0,false,, 1.0\n"
    . "2025-11-07 12:00:00 +0000,Running, 0,0.0,1800.0,5000.0,0.0,0.0,false,, 1.0\n"
    . "2025-11-08 12:00:00 +0000,Stair Stepper, 0,0.0,900.0,0.0,0.0,0.0,false,, 1.0\n";
$fp = FitbodImport::parse($fitbodCsv);
check('Fitbod stationary bike and stair stepper are imported; outdoor runs are still skipped', isset($fp['names']['Cycling - Stationary'], $fp['names']['Stair Stepper']) && $fp['skipped'] === ['Running' => 1]);
$fImp = new FitbodImport($db);
$fRes = $fImp->run($cUid, $cGym, 'lb', $fp, $fImp->plan($cUid, $fp));
$fw = $wk->get($cUid, current(array_filter($wk->history($cUid, 5), static fn($w) => $w['started_at'] === '2025-11-06T19:23:18Z'))['id']);
check('an imported bike warm-up keeps its time, distance and level, in the same workout as the lifts', $fRes['workouts'] === 2 && $fw['exercises'][0]['name'] === 'Stationary Bike' && $fw['exercises'][0]['sets'][0]['duration_s'] === 300 && $fw['exercises'][0]['sets'][0]['distance_m'] === 2607.1 && $fw['exercises'][0]['sets'][0]['level'] === 12.0 && $fw['exercises'][1]['name'] === 'Barbell Bench Press' && $fw['exercises'][0]['target_seconds'] === 300, json_encode($fw['exercises'][0] ?? null));

echo "Stretches\n";
$stretchEx = array_values(array_filter(Catalog::exercises(), static fn($e) => $e[2] === 'stretch'));
check('built-in stretches need no equipment and are dynamic or static (' . count($stretchEx) . ')', count($stretchEx) >= 14 && !array_filter($stretchEx, static fn($e) => $e[3] !== [] || !in_array($e[4], Catalog::STRETCH_PATTERNS, true) || !$e[5]));
check('every per-side stretch is a real built-in stretch', !array_diff(Catalog::PER_SIDE, array_column($stretchEx, 0)));
check('stretches are logged as time, like cardio', Catalog::isTimed('stretch'));
$sUid = $auth->createUser('stretch-user', 'stretch-user-123');
$sUser = $db->one('SELECT * FROM users WHERE id=?', [$sUid]);
$sGym = $mkGym($sUid, 'Stretch gym', ['barbell', 'bench', 'rack', 'dumbbells', 'stationary_bike', 'leg_press', 'leg_curl', 'leg_extension']);
$at = ['now' => strtotime('2026-11-10T12:00:00Z')];
$kinds = static fn($plan) => array_column($plan['exercises'], 'kind');
$lifts = static fn($plan) => array_values(array_filter($plan['exercises'], static fn($b) => !Catalog::isTimed($b['kind'])));
$none = $gen->generate($sUser, $sGym, ['day_type' => 'legs'] + $at);
check('without either box, no stretches and no warm-up', !array_intersect($kinds($none), ['stretch', 'cardio']) && $none['stretches'] === false);
$warmOnly = $gen->generate($sUser, $sGym, ['day_type' => 'legs', 'warm_up' => true] + $at);
check('Include a warm-up by itself: the cardio warm-up as before, no stretches', $warmOnly['exercises'][0]['kind'] === 'cardio' && !in_array('stretch', $kinds($warmOnly), true));
$cool = $gen->generate($sUser, $sGym, ['day_type' => 'legs', 'stretches' => true] + $at);
$coolN = count(array_filter($cool['exercises'], static fn($b) => $b['kind'] === 'stretch'));
$coolTail = array_slice($cool['exercises'], -$coolN);
check('Include stretches by itself: 2 or 3 cooldown stretches after the lifting, no warm-up', $cool['stretches'] === true && $cool['exercises'][0]['kind'] !== 'cardio' && $coolN >= 2 && $coolN <= 3
    && !array_filter($coolTail, static fn($b) => $b['pattern'] !== 'static_stretch') && $cool['exercises'][count($cool['exercises']) - $coolN - 1]['kind'] !== 'stretch', (string) $coolN);
check('a leg day cools down with leg stretches', count(array_intersect(array_column($coolTail, 'name'), ['Standing Quad Stretch', 'Seated Hamstring Stretch', 'Figure-Four Glute Stretch', 'Kneeling Hip Flexor Stretch', 'Wall Calf Stretch'])) >= 2, implode(', ', array_column($coolTail, 'name')));
check('the cooldown stretches are all different', count(array_unique(array_column($coolTail, 'exercise_id'))) === $coolN);
$short = $gen->generate($sUser, $sGym, ['day_type' => 'legs', 'stretches' => true, 'warm_up' => true, 'minutes' => 30] + $at);
$shortCounts = array_count_values(array_map(static fn($b) => $b['pattern'], array_filter($short['exercises'], static fn($b) => $b['kind'] === 'stretch')));
check('a 30-minute workout gets 2 stretches at each end', ($shortCounts['dynamic_stretch'] ?? 0) === 2 && ($shortCounts['static_stretch'] ?? 0) === 2, json_encode($shortCounts));
$full = $gen->generate($sUser, $sGym, ['day_type' => 'full', 'stretches' => true, 'warm_up' => true, 'minutes' => 75] + $at);
$fullCounts = array_count_values(array_map(static fn($b) => $b['pattern'], array_filter($full['exercises'], static fn($b) => $b['kind'] === 'stretch')));
check('a long full-body workout gets 3 at each end, never more', ($fullCounts['dynamic_stretch'] ?? 0) === 3 && ($fullCounts['static_stretch'] ?? 0) === 3, json_encode($fullCounts));
$both = $gen->generate($sUser, $sGym, ['day_type' => 'legs', 'warm_up' => true, 'stretches' => true] + $at);
$order = array_map(static fn($b) => $b['kind'] === 'cardio' ? 'cardio' : ($b['pattern'] === 'dynamic_stretch' ? 'dynamic' : ($b['pattern'] === 'static_stretch' ? 'cooldown' : 'lift')), $both['exercises']);
$collapsed = array_values(array_unique($order));
check('both boxes: cardio warm-up, then 2 or 3 dynamic stretches, then lifting, then the same number of cooldown stretches', $collapsed === ['cardio', 'dynamic', 'lift', 'cooldown'] && in_array(count(array_keys($order, 'dynamic')), [2, 3], true) && count(array_keys($order, 'dynamic')) === count(array_keys($order, 'cooldown')), implode(' ', $order));
check('stretch time is part of the plan estimate, and stretches never add lifts', $both['est_minutes'] === (int) round(array_sum(array_column($both['exercises'], 'minutes'))) && $cool['est_minutes'] > 0 && count($lifts($cool)) <= count($lifts($none)) && count($lifts($both)) <= count($lifts($warmOnly)));
$quad = null;
foreach ($cool['exercises'] as $b) {
    if ($b['name'] === 'Standing Quad Stretch') {
        $quad = $b;
    }
}
$childs = $gen->block($sUser, $sGym, Catalog::forUser($db, $sUid)[array_search("Child's Pose", array_column(Catalog::forUser($db, $sUid), 'name'), true)]);
check('a stretch done on each side is two 30-second holds; one done once is a single hold', ($quad === null || ($quad['target_sets'] === 2 && $quad['per_side'] === true)) && $childs['target_sets'] === 1 && $childs['target_seconds'] === 30 && $childs['suggested_weight'] === null && $childs['per_side'] === false);
$bwStretch = $gen->generate($sUser, $sGym, ['day_type' => 'legs', 'stretches' => true, 'bodyweight_only' => true] + $at);
check('bodyweight-only workouts still get stretches', in_array('stretch', $kinds($bwStretch), true));
$alts = $gen->alternatives($sUid, $sGym, $bySlug['standing-quad-stretch']);
$patternOf = array_column(Catalog::forUser($db, $sUid), 'pattern', 'id');
check('swapping a stretch only offers other stretches of the same kind', $alts && !array_filter($alts, static fn($a) => $patternOf[$a['exercise_id']] !== 'static_stretch'), json_encode($alts));
// Log a workout with a cooldown stretch: it stays out of volume, recovery and progression.
$before = $gen->muscleStats($sUid, strtotime('2026-11-10T12:00:00Z'));
$sDoc = $doc($sGym, 'legs', [[$bySlug['back-squat'], 6, 10, [[185, 10], [185, 10]]]], '2026-11-09T17:00:00Z');
$sDoc['exercises'][] = ['id' => uuid(), 'exercise_id' => $bySlug['standing-quad-stretch'], 'rep_min' => 1, 'rep_max' => 1, 'target_sets' => 2, 'target_seconds' => 30, 'rest_seconds' => 0,
    'sets' => [['id' => uuid(), 'weight' => null, 'reps' => null, 'duration_s' => 30, 'done' => true, 'done_at' => '2026-11-09T17:30:00Z'], ['id' => uuid(), 'weight' => null, 'reps' => null, 'duration_s' => 35, 'done' => true, 'done_at' => '2026-11-09T17:31:00Z']]];
$wk->save($sUid, $sDoc);
$sHist = $wk->history($sUid)[0];
check('logged stretches show in History', in_array('Standing Quad Stretch', $sHist['exercises'], true) && $wk->get($sUid, $sDoc['id'])['exercises'][1]['sets'][1]['duration_s'] === 35);
check('stretches add nothing to lifting volume or set counts', $sHist['sets'] === 2 && (int) $sHist['volume'] === 185 * 20);
$withStretch = $gen->muscleStats($sUid, strtotime('2026-11-10T12:00:00Z'));
$sDoc2 = $sDoc;
$sDoc2['id'] = uuid();
array_pop($sDoc2['exercises']);
$sDoc2['exercises'][0]['id'] = uuid();
foreach ($sDoc2['exercises'][0]['sets'] as &$ss) { $ss['id'] = uuid(); }
unset($ss);
$wk->delete($sUid, $sDoc['id']);
$wk->save($sUid, $sDoc2);
$withoutStretch = $gen->muscleStats($sUid, strtotime('2026-11-10T12:00:00Z'));
check('stretches do not change the recovery estimate', $withStretch === $withoutStretch, json_encode([$withStretch['quads'], $withoutStretch['quads']]));
check('stretches are never given a weight to progress', $gen->block($sUser, $sGym, Catalog::forUser($db, $sUid)[array_search('Standing Quad Stretch', array_column(Catalog::forUser($db, $sUid), 'name'), true)])['suggested_weight'] === null);
$wk->delete($sUid, $sDoc2['id']);
$db->run('DELETE FROM gyms WHERE user_id=?', [$sUid]);
$db->run('DELETE FROM users WHERE id=?', [$sUid]);
check('a stretch counts a gentler effort than cardio for calories', \TF\Calories::STRETCH_MET < \TF\Calories::CARDIO_MET_DEFAULT);
check('short holds read in seconds on Strava', \TF\StravaStrength::cardioText(['duration_s' => 30], false) === '30 s' && \TF\StravaStrength::cardioText(['duration_s' => 600], false) === '10 min');

echo "Workout recap and records\n";
$rUid = $auth->createUser('recap-user', 'recap-user-123');
$rGymA = $mkGym($rUid, 'Gym A', ['barbell', 'bench', 'rack', 'chest_press', 'stationary_bike']);
$rGymB = $mkGym($rUid, 'Gym B', ['barbell', 'bench', 'rack', 'chest_press']);
$rb = $bySlug['barbell-bench-press'];
$rm = $bySlug['machine-chest-press'];
$r1 = $doc($rGymA, 'push', [[$rb, 6, 10, [[95, 10, true], [135, 8], [135, 8], [135, 7]]], [$rm, 8, 12, [[100, 10]]]], '2026-10-01T17:00:00Z');
$wk->save($rUid, $r1);
$rc = $wk->recap($rUid, $r1['id']);
check('the recap counts working sets, not warm-ups', $rc['working_sets'] === 4 && $rc['exercises'] === 2);
check('lifts never logged before are first results, not records', !$rc['records'] && array_column($rc['firsts'], 'name') === ['Barbell Bench Press', 'Machine Chest Press'] && $rc['firsts'][0]['weight'] === 135.0 && $rc['firsts'][0]['reps'] === 8);
$r2 = $doc($rGymA, 'push', [[$rb, 6, 10, [[135, 10], [135, 9]]]], '2026-10-04T17:00:00Z');
$wk->save($rUid, $r2);
$rc = $wk->recap($rUid, $r2['id']);
check('more reps at a weight already lifted is a record: 135 × 10, up from 8', count($rc['records']) === 1 && $rc['records'][0]['type'] === 'reps' && $rc['records'][0]['weight'] === 135.0 && $rc['records'][0]['reps'] === 10 && $rc['records'][0]['previous_reps'] === 8 && !$rc['firsts'], json_encode($rc));
$r3 = $doc($rGymA, 'push', [[$rb, 6, 10, [[200, 1, true], [140, 6], [135, 10]]]], '2026-10-08T17:00:00Z');
$wk->save($rUid, $r3);
$rc = $wk->recap($rUid, $r3['id']);
check('a heavier weight than ever before is a record, and a heavier warm-up does not count', count($rc['records']) === 1 && $rc['records'][0]['type'] === 'weight' && $rc['records'][0]['weight'] === 140.0 && $rc['records'][0]['previous_weight'] === 135.0, json_encode($rc));
$r4 = $doc($rGymA, 'push', [[$rb, 6, 10, [[140, 6], [135, 9]]]], '2026-10-11T17:00:00Z');
$wk->save($rUid, $r4);
check('matching earlier results is not a record', $wk->recap($rUid, $r4['id'])['records'] === []);
check('an older workout is only compared with what came before it', $wk->recap($rUid, $r2['id'])['records'][0]['previous_reps'] === 8);
$r5 = $doc($rGymA, 'push', [[$rb, 6, 10, [[65, 5]]]], '2026-10-15T17:00:00Z');
$r5['unit'] = 'kg';
$wk->save($rUid, $r5);
$rc = $wk->recap($rUid, $r5['id']);
check('pounds and kilograms compare correctly: 65 kg beats 140 lb (63.5 kg)', count($rc['records']) === 1 && $rc['records'][0]['type'] === 'weight' && $rc['unit'] === 'kg' && abs($rc['records'][0]['previous_weight'] - 63.5) < 0.1, json_encode($rc));
$r6 = $doc($rGymA, 'push', [[$rb, 6, 10, [[143, 6]]]], '2026-10-18T17:00:00Z');
$wk->save($rUid, $r6);
$rc = $wk->recap($rUid, $r6['id']);
check('143 lb is not heavier than 65 kg (143.3 lb), but 6 reps beats 5 at about that weight', count($rc['records']) === 1 && $rc['records'][0]['type'] === 'reps' && $rc['records'][0]['previous_reps'] === 5, json_encode($rc));
$r7 = $doc($rGymB, 'push', [[$rm, 8, 12, [[90, 12]]]], '2026-10-20T17:00:00Z');
$wk->save($rUid, $r7);
$rc = $wk->recap($rUid, $r7['id']);
check('machines compare only at the same gym: a first result at another gym', !$rc['records'] && array_column($rc['firsts'], 'name') === ['Machine Chest Press']);
$r8 = $doc($rGymA, 'push', [[$rb, 6, 10, [[150, 3]]]], '2026-10-22T17:00:00Z');
array_unshift($r8['exercises'], ['id' => uuid(), 'exercise_id' => $bySlug['stationary-bike'], 'rep_min' => 1, 'rep_max' => 1, 'target_sets' => 1, 'target_seconds' => 600,
    'sets' => [['id' => uuid(), 'weight' => null, 'reps' => null, 'duration_s' => 600, 'done' => true, 'done_at' => '2026-10-22T17:10:00Z']]]);
$wk->save($rUid, $r8);
$rc = $wk->recap($rUid, $r8['id']);
check('cardio is left out of the recap', $rc['exercises'] === 1 && $rc['working_sets'] === 1 && !array_filter(array_merge($rc['records'], $rc['firsts']), static fn($x) => $x['name'] === 'Stationary Bike'));
$other = $doc($rGymA, 'push', [[$rb, 6, 10, [[300, 10]]]], '2026-09-01T17:00:00Z');
$wk->save($uid2, $other);
check("another account's lifts never count", $wk->recap($rUid, $r8['id'])['records'][0]['previous_weight'] === round(65 * 2.20462262, 1));
$active = $doc($rGymA, 'push', [[$rb, 6, 10, [[155, 5]]]], '2026-10-25T17:00:00Z', 'active');
$wk->save($rUid, $active);
check('a workout still in progress has no recap', $wk->recap($rUid, $active['id']) === null && $wk->recap($uid2, $r8['id']) === null);
foreach ([$r1, $r2, $r3, $r4, $r5, $r6, $r7, $r8, $active] as $d) {
    $wk->delete($rUid, $d['id']);
}
$wk->delete($uid2, $other['id']);
$db->run('DELETE FROM gyms WHERE user_id=?', [$rUid]);
$db->run('DELETE FROM users WHERE id=?', [$rUid]);

echo "Setup notes\n";
$nUid = $auth->createUser('notes-user', 'notes-user-123');
$nGymA = $mkGym($nUid, 'Gym A', ['barbell', 'bench', 'rack', 'chest_press']);
$nGymB = $mkGym($nUid, 'Gym B', ['barbell', 'bench', 'rack', 'chest_press']);
$nb = $bySlug['barbell-bench-press'];
$nm = $bySlug['machine-chest-press'];
$key = static fn($exId, $gym) => TF\Workouts::noteKey($exId, $gym['id']);
$n1 = $doc($nGymA, 'push', [[$nm, 8, 12, [[100, 10]]], [$nb, 6, 10, [[135, 8]]]], '2026-11-01T17:00:00Z', 'active');
$n1['exercises'][0]['setup_note'] = '  Seat on 4,   wide handle ';
$n1['exercises'][1]['setup_note'] = 'Thumbless grip';
$wk->save($nUid, $n1);
$notesNow = $wk->notes($nUid);
check('a note saved with the workout is kept for that exercise at that gym, tidied', $notesNow[$key($nm, $nGymA)] === 'Seat on 4, wide handle' && $notesNow[$key($nb, $nGymA)] === 'Thumbless grip' && count($notesNow) === 2);
$atA = $wk->withNotes($nUid, [['exercise_id' => $nm], ['exercise_id' => $nb]], $nGymA['id']);
$atB = $wk->withNotes($nUid, [['exercise_id' => $nm], ['exercise_id' => $nb]], $nGymB['id']);
check('every note is per gym: machines and barbells alike show only at the gym it was saved for', $atA[0]['note'] === 'Seat on 4, wide handle' && $atA[1]['note'] === 'Thumbless grip' && $atB[0]['note'] === null && $atB[1]['note'] === null);
$nUser = $db->one('SELECT * FROM users WHERE id=?', [$nUid]);
$cat = Catalog::forUser($db, $nUid);
$block = $wk->withNotes($nUid, [$gen->block($nUser, $nGymA, $cat[array_search('Machine Chest Press', array_column($cat, 'name'), true)])], $nGymA['id'])[0];
check('the next plan for that exercise at that gym carries the note', $block['note'] === 'Seat on 4, wide handle');
$n1['rev'] = 2;
$n1['exercises'][0]['setup_note'] = 'Seat on 5';
unset($n1['exercises'][1]['setup_note']);
$wk->save($nUid, $n1);
check('updating a note replaces it; leaving it out keeps the old one', $wk->notes($nUid)[$key($nm, $nGymA)] === 'Seat on 5' && $wk->notes($nUid)[$key($nb, $nGymA)] === 'Thumbless grip');
$n1['rev'] = 3;
$n1['exercises'][1]['setup_note'] = '   ';
$wk->save($nUid, $n1);
check('an empty note clears it', !isset($wk->notes($nUid)[$key($nb, $nGymA)]));
$n1['rev'] = 1;
$n1['exercises'][0]['setup_note'] = 'stale';
$wk->save($nUid, $n1);
check('an older copy of the workout arriving late does not overwrite the note', $wk->notes($nUid)[$key($nm, $nGymA)] === 'Seat on 5');
$n1['rev'] = 4;
$n1['exercises'][0]['setup_note'] = str_repeat('x', 300);
$wk->save($nUid, $n1);
check('notes are capped at 200 characters', mb_strlen($wk->notes($nUid)[$key($nm, $nGymA)]) === 200);
check('notes are private to each account', $wk->notes($uid2) === [] && $wk->withNotes($uid2, [['exercise_id' => $nm]], $nGymA['id'])[0]['note'] === null);
check('a saved workout does not carry the note back, so editing History never changes it', !array_key_exists('setup_note', $wk->get($nUid, $n1['id'])['exercises'][0]));
$wk->delete($nUid, $n1['id']);
check('deleting the workout keeps the note', isset($wk->notes($nUid)[$key($nm, $nGymA)]));
// The exercise page: one note per gym, for any exercise.
$gymsN = array_map([TF\Generator::class, 'gymShape'], $db->all('SELECT * FROM gyms WHERE user_id=? ORDER BY id', [$nUid]));
$wk->setNote($nUid, TF\Workouts::noteKey($nb, $nGymB['id']), ' Close grip  at Gym B ');
$page = $wk->exerciseNotes($nUid, $nb, $gymsN);
check('the exercise page lists a note for each gym', array_column($page, 'gym_name') === ['Gym A', 'Gym B'] && $page[0]['note'] === null && $page[1]['note'] === 'Close grip at Gym B', json_encode($page));
check('a note saved on the exercise page shows in that gym\'s next plan', $wk->withNotes($nUid, [['exercise_id' => $nb]], $nGymB['id'])[0]['note'] === 'Close grip at Gym B');
$wk->setNote($nUid, TF\Workouts::noteKey($nb, $nGymB['id']), '');
check('and can be cleared there', $wk->exerciseNotes($nUid, $nb, $gymsN)[1]['note'] === null);
$noGym = $doc(['id' => null], 'push', [[$nb, 6, 10, [[95, 8]]]], '2026-11-02T17:00:00Z', 'active');
$noGym['exercises'][0]['setup_note'] = 'Hotel gym';
$wk->save($nUid, $noGym);
check('a workout with no gym keeps its notes apart from every gym', $wk->withNotes($nUid, [['exercise_id' => $nb]], null)[0]['note'] === 'Hotel gym' && $wk->exerciseNotes($nUid, $nb, $gymsN)[0]['note'] === null);
$wk->delete($nUid, $noGym['id']);
$db->run('DELETE FROM exercise_notes WHERE user_id=?', [$nUid]);
$db->run('DELETE FROM gyms WHERE user_id=?', [$nUid]);
$db->run('DELETE FROM users WHERE id=?', [$nUid]);

echo "Muscle illustrations\n";
$artDir = dirname(__DIR__) . '/web/icons/muscles';
$missingArt = array_filter(array_keys(Catalog::MUSCLES), static fn($m) => !is_file("$artDir/$m.png") || filesize("$artDir/$m.png") < 1000);
check('all 13 muscle groups have their illustration (#150)', count(Catalog::MUSCLES) === 13 && !$missingArt, implode(', ', $missingArt));
preg_match('/const MUSCLE_ART = \[([^\]]+)\]/', file_get_contents(dirname(__DIR__) . '/web/js/app.js'), $artList);
check('the app maps every muscle group to its illustration', isset($artList[1]) && str_replace(["'", ' '], '', $artList[1]) === implode(',', array_keys(Catalog::MUSCLES)));
$artInfo = getimagesize("$artDir/lats.png");
check('the illustrations are small PNGs with a transparent background', $artInfo[2] === IMAGETYPE_PNG && $artInfo[0] <= 300 && $artInfo[1] <= 300 && array_sum(array_map('filesize', glob("$artDir/*.png"))) < 250000);
$sizes = array_unique(array_map(static fn($f) => implode('x', array_slice(getimagesize($f), 0, 2)), glob("$artDir/*.png")));
check('every illustration has the same square size, so narrow ones (legs) line up with the rest', count($sizes) === 1 && reset($sizes) === '240x240', implode(' ', $sizes));

echo "Picked muscle groups\n";
$pGym = $mkGym($uid2, 'Pick gym', Catalog::presets()[0]['equipment']);
$samUser = $db->one('SELECT * FROM users WHERE id=?', [$uid2]);
$pick = $gen->generate($samUser, $pGym, ['day_type' => 'custom', 'muscles' => ['lats', 'biceps']]);
$pLifts = array_values(array_filter($pick['exercises'], static fn($b) => !Catalog::isTimed($b['kind'])));
$mainOf = array_column(Catalog::forUser($db, $uid2), 'muscles_main', 'id');
check('picking lats and biceps plans only lifts whose main muscles include them (#154)', $pick['day_type'] === 'custom' && $pick['muscles'] === ['biceps', 'lats'] && count($pLifts) >= 2
    && !array_filter($pLifts, static fn($b) => !array_intersect(['lats', 'biceps'], $mainOf[$b['exercise_id']])), json_encode(array_column($pLifts, 'name')));
check('each picked muscle gets at least one lift', (bool) array_filter($pLifts, static fn($b) => in_array('lats', $mainOf[$b['exercise_id']], true)) && (bool) array_filter($pLifts, static fn($b) => in_array('biceps', $mainOf[$b['exercise_id']], true)));
$fore = $gen->generate($samUser, $pGym, ['day_type' => 'custom', 'muscles' => ['forearms']]);
check('even forearms gets a lift', (bool) array_filter($fore['exercises'], static fn($b) => in_array('forearms', $mainOf[$b['exercise_id']] ?? [], true)));
$junk = $gen->generate($samUser, $pGym, ['day_type' => 'custom', 'muscles' => ['tail']]);
check('unknown muscles fall back to the usual split day', $junk['day_type'] !== 'custom' && $junk['muscles'] === []);
check('a custom day does not change the split rotation', $gen->nextDayType($uid2, 'ppl') === $gen->nextDayType($uid2, 'ppl'));
$db->run('DELETE FROM gyms WHERE id=?', [$pGym['id']]);

echo "Estimated calories\n";
$kUid = $auth->createUser('calorie-user', 'calorie-user-123');
$kGym = $mkGym($kUid, 'Calorie gym', ['barbell', 'bench', 'rack', 'stationary_bike']);
$hour = function (?string $effort, bool $warm = false, string $start = '2026-11-09T10:00:00Z', string $end = '2026-11-09T11:00:00Z') use ($doc, $kGym, $bench, $bySlug): array {
    $w = $doc($kGym, 'push', [[$bench, 6, 10, [[135, 8], [135, 8]]]], $start);
    $w['completed_at'] = $end;
    $w['exercises'][0]['sets'][0]['done_at'] = '2026-11-09T10:15:00Z';
    $w['exercises'][0]['sets'][1]['done_at'] = '2026-11-09T10:50:00Z';
    $w['effort'] = $effort;
    if ($warm) {
        array_unshift($w['exercises'], ['id' => uuid(), 'exercise_id' => $bySlug['stationary-bike'], 'rep_min' => 1, 'rep_max' => 1, 'target_sets' => 1, 'target_seconds' => 600,
            'sets' => [['id' => uuid(), 'weight' => null, 'reps' => null, 'duration_s' => 600, 'distance_m' => 4000.0, 'level' => 8, 'done' => true, 'done_at' => '2026-11-09T10:10:00Z']]]);
    }
    return $w;
};
$kSave = function (array $w) use ($wk, $kUid): array {
    $wk->save($kUid, $w);
    return $wk->get($kUid, $w['id']);
};
$moderate = $kSave($hour('moderate'));
check('no body weight, no estimate', TF\Calories::estimate($moderate, null) === null);
check('an hour of lifting at 80 kg: light 280, moderate 400, hard 480 (MET × kg × hours)',
    TF\Calories::estimate($kSave($hour('light')), 80.0) === 280 && TF\Calories::estimate($moderate, 80.0) === 400 && TF\Calories::estimate($kSave($hour('hard')), 80.0) === 480);
check('the effort is saved with the workout, and a missing or unknown one counts as moderate',
    $moderate['effort'] === 'moderate' && ($unknown = $kSave($hour('extreme')))['effort'] === null && TF\Calories::estimate($unknown, 80.0) === 400);
$withBike = $kSave($hour('moderate', true));
check('a 10-minute bike warm-up counts at the bike\'s value and the other 50 minutes as lifting (64 + 333 = 397)', TF\Calories::estimate($withBike, 80.0) === 397);
check('a workout left open overnight uses the same trimmed time as Trends and Strava',
    TF\Calories::estimate($kSave($hour('moderate', false, '2026-11-09T10:00:00Z', '2026-11-10T04:00:00Z')), 80.0) === (int) round(5.0 * 80 * (55 / 60)));
check('an imported workout without a duration has no estimate', TF\Calories::estimate($kSave($hour('moderate', false, '2026-11-09T10:00:00Z', '2026-11-09T10:00:00Z')), 80.0) === null);
$db->run('UPDATE users SET body_weight_kg=80 WHERE id=?', [$uid]);
if (!$strava->connection($uid)['connected']) {
    $strava->connect($uid, $session, ['state' => $getState(), 'code' => 'calorie-code', 'scope' => 'activity:write']);
}
$calDoc = $hour('moderate', true);
$calDoc['gym_id'] = $big['id'];
$wk->save($uid, $calDoc);
$requests = [];
$reply = [201, ['id' => '1', 'id_str' => '1', 'activity_id' => 55501]];
$strava->export($uid, $calDoc['id'], true, 0, true);
$stravaFile = json_decode((string) ($requests[0][3] ?? $requests[1][3] ?? 'null'), true);
check('with exercises included, Strava gets the estimate as total_calories in the strength file', ($stravaFile['total_calories'] ?? null) === 397 && count($stravaFile['sets']) === 2, json_encode($stravaFile));
$calDoc2 = $hour('moderate', true);
$calDoc2['gym_id'] = $big['id'];
$wk->save($uid, $calDoc2);
$requests = [];
$reply = [201, ['id' => '55502']];
$strava->export($uid, $calDoc2['id'], false, 0, true);
$basic = end($requests);
check('without exercises (no strength file), the estimate goes in the description', $basic[3] === null && ($basic[1]['description'] ?? '') === 'Estimated calories: 397');
$calDoc3 = $hour('moderate');
$calDoc3['gym_id'] = $big['id'];
$wk->save($uid, $calDoc3);
$requests = [];
$reply = [201, ['id' => '1', 'id_str' => '1', 'activity_id' => 55503]];
$strava->export($uid, $calDoc3['id'], true, 0, false);
$plainFile = json_decode((string) end($requests)[3], true);
check('calories are only sent when asked for', !isset($plainFile['total_calories']));
$db->run('UPDATE users SET body_weight_kg=NULL WHERE id=?', [$uid]);

echo "Upgrading a database that already has accounts\n";
$old = $freshDb('upgrade');
Migrator::ensure($old, 2);
check('an older database has no roles yet', !(new Migrator($old))->hasColumn('users', 'role') && Migrator::current($old) === 2);
// Ids deliberately out of step with creation dates: the earliest-created account must win, not the lowest id.
foreach ([['later', '2026-03-01 10:00:00'], ['earliest', '2025-01-05 08:00:00'], ['middle', '2025-06-01 09:00:00']] as [$name, $when]) {
    $old->insert('users', ['username' => $name, 'password_hash' => 'x', 'display_name' => $name, 'created_at' => $when]);
}
check('the migrations apply', Migrator::ensure($old) === array_values(array_filter(array_keys(Migrator::files()), static fn($v) => $v > 2)));
$roles = [];
foreach ($old->all('SELECT username, role FROM users') as $r) {
    $roles[$r['username']] = $r['role'];
}
check('the earliest-created account becomes the admin, the rest stay regular users', $roles === ['later' => 'user', 'earliest' => 'admin', 'middle' => 'user'], json_encode($roles));
$authOld = new Auth($old, []);
$newId = $authOld->createUser('newcomer', 'a long enough password');
check('accounts that existed before requests were added stay active and can sign in', (int) $old->val("SELECT COUNT(*) FROM users WHERE status<>'active'") === 0 && (int) $old->val('SELECT COUNT(*) FROM users') === 4);
check('accounts added afterwards are regular users', $old->val('SELECT role FROM users WHERE id=?', [$newId]) === 'user' && (int) $old->val("SELECT COUNT(*) FROM users WHERE role='admin'") === 1);
$fn = require dirname(__DIR__) . '/web/private/migrations/003_user_roles.php';
$fn($old, new Migrator($old));
check('running the migration again changes nothing', (int) $old->val("SELECT COUNT(*) FROM users WHERE role='admin'") === 1 && $old->val("SELECT username FROM users WHERE role='admin'") === 'earliest');
$empty = $freshDb('empty');
Migrator::ensure($empty);
check('a brand-new database has no admin until the first account is created', (int) $empty->val('SELECT COUNT(*) FROM users') === 0);
unset($old, $authOld, $empty);
foreach (['upgrade', 'empty'] as $sfx) {
    @unlink("$file-$sfx");
    @unlink("$file-$sfx-wal");
    @unlink("$file-$sfx-shm");
}

echo "Most-performed exercises (#174)\n";
$cu = $auth->createUser('counter', 'counter long password');
$cg = $mkGym($cu, 'Count gym', Catalog::equipmentKeys());
$squat = $bySlug['back-squat'];
$wk->save($cu, $doc($cg, 'push', [[$bench, 6, 10, [[135, 8], [135, 8]]], [$squat, 6, 10, [[185, 5]]]], $ago(3)));
$wk->save($cu, $doc($cg, 'push', [[$bench, 6, 10, [[135, 8]]], [$press, 8, 12, [[90, 10, false, false]]]], $ago(2)));
$wk->save($cu, $doc($cg, 'push', [[$press, 8, 12, [[90, 10]]]], $ago(1), 'active'));
$counts = $wk->exerciseCounts($cu);
check('counts each exercise once per finished workout, not once per set', ($counts[$bench] ?? 0) === 2 && ($counts[$squat] ?? 0) === 1, json_encode($counts));
check('an exercise with no logged sets, or only in an unfinished workout, is not counted', !isset($counts[$press]), json_encode($counts));
check('a new lifter has no counts, so Add exercise stays alphabetical', $wk->exerciseCounts($auth->createUser('newbie', 'newbie long password')) === []);
check('other lifters\' workouts are not counted', ($wk->exerciseCounts($uid)[$bench] ?? 0) === count($wk->exerciseHistory($uid, $bench)), json_encode([$wk->exerciseCounts($uid)[$bench] ?? 0, count($wk->exerciseHistory($uid, $bench))]));

echo "Difficulty ratings (#170)\n";
$lastAt = fn(array $reps, ?int $left, float $w = 135) => ['unit' => 'lb', 'sets' => array_map(static fn($r) => ['weight' => $w, 'reps' => $r], $reps), 'reps_left' => $left];
$top0 = Generator::progress($lastAt([10, 10, 10], 0), 6, 10, 5, 'lb');
$top4 = Generator::progress($lastAt([10, 10, 10], 4), 6, 10, 5, 'lb');
$topN = Generator::progress($lastAt([10, 10, 10], null), 6, 10, 5, 'lb');
$top2 = Generator::progress($lastAt([10, 10, 10], 2), 6, 10, 5, 'lb');
check('the same completed target leads to different suggestions for 4+ and 0 reps left', $top4['weight'] === 140.0 && $top4['action'] === 'increase' && $top0['weight'] === 135.0 && $top0['reps'] === 10 && $top0['action'] === 'stay', json_encode([$top4, $top0]));
check('no rating, or a rating of 2, keeps the usual progression', $topN['weight'] === $top2['weight'] && $topN['reps'] === $top2['reps'] && $topN['action'] === 'increase');
$mid3 = Generator::progress($lastAt([8, 8, 7], 3), 6, 10, 5, 'lb');
$mid1 = Generator::progress($lastAt([8, 8, 7], 1), 6, 10, 5, 'lb');
$midN = Generator::progress($lastAt([8, 8, 7], null), 6, 10, 5, 'lb');
check('short of the target, 3+ reps left aims two reps higher, 0-1 repeats, unrated adds one', $mid3['reps'] === 9 && $mid1['reps'] === 7 && $midN['reps'] === 8 && $mid3['weight'] === 135.0 && $mid1['weight'] === 135.0, json_encode([$mid3['reps'], $mid1['reps'], $midN['reps']]));
$low0 = Generator::progress($lastAt([6, 5, 4], 0), 6, 10, 5, 'lb');
$lowN = Generator::progress($lastAt([6, 5, 4], null), 6, 10, 5, 'lb');
check('the load comes down only when it felt maxed out and the logged reps fell below the range', $low0['weight'] === 130.0 && $low0['action'] === 'decrease' && $lowN['weight'] === 135.0, json_encode([$low0, $lowN]));
check('the reason mentions how it felt', strpos($top0['why'], 'only 0 reps left') !== false && strpos($mid3['why'], '3 reps left') !== false && strpos($top4['why'], '4 or more reps left') !== false, $top0['why']);
check('only 0-4 are kept as ratings', Workouts::repsLeft(0) === 0 && Workouts::repsLeft('4') === 4 && Workouts::repsLeft(5) === null && Workouts::repsLeft(-1) === null && Workouts::repsLeft(2.5) === null && Workouts::repsLeft(null) === null);
$ru = $auth->createUser('rater', 'rater long password');
$rg = $mkGym($ru, 'Rate gym', Catalog::equipmentKeys());
$rd = $doc($rg, 'push', [[$bench, 6, 10, [[135, 10], [135, 10], [135, 10]]]], $ago(2));
$rd['exercises'][0]['reps_left'] = 0;
$wk->save($ru, $rd);
check('a rating saved with a finished workout comes back with it', $wk->get($ru, $rd['id'])['exercises'][0]['reps_left'] === 0);
$ruser = $db->one('SELECT * FROM users WHERE id=?', [$ru]);
$rb = $gen->block($ruser, $rg, $exById[$bench]);
check('the next suggestion for the same setup uses the latest rating', $rb['suggested_weight'] === $top0['weight'] && $rb['previous']['reps_left'] === 0, json_encode([$rb['suggested_weight'], $rb['reason']]));
$rd2 = $doc($rg, 'push', [[$bench, 6, 10, [[135, 10], [135, 10], [135, 10]]]], $ago(1));
$wk->save($ru, $rd2);
$rb2 = $gen->block($ruser, $rg, $exById[$bench]);
check('an unrated latest session uses the usual rules, not an older rating', $rb2['previous']['reps_left'] === null && $rb2['suggested_weight'] === 140.0, json_encode([$rb2['suggested_weight'], $rb2['previous']['reps_left'] ?? 'x']));

echo "Stalled lifts (#124)\n";
$su = $auth->createUser('staller', 'staller long password');
$sg = $mkGym($su, 'Stall gym', Catalog::equipmentKeys());
$suser = $db->one('SELECT * FROM users WHERE id=?', [$su]);
$squatS = $bySlug['back-squat'];
$stallBlock = fn() => $gen->block($suser, $sg, $exById[$squatS]);
check('fewer than three sessions is never a stall', $stallBlock()['stall'] === null);
foreach ([5, 4, 3] as $i => $d) {
    $wk->save($su, $doc($sg, 'legs', [[$squatS, 6, 10, [[225, 8], [225, 7], [225, 6]]]], $ago($d)));
}
$sb = $stallBlock();
check('three sessions at the same weight with no more reps is a stall, with repeat and lighter options', $sb['stall'] !== null && $sb['stall']['sessions'] === 3 && $sb['stall']['weight'] === 225.0 && $sb['stall']['repeat'] === ['weight' => 225.0, 'reps' => 8] && $sb['stall']['lower']['weight'] < 225.0 && $sb['stall']['lower']['weight'] >= 200.0, json_encode($sb['stall']));
check('the usual suggestion stays the default alongside the stall', $sb['suggested_weight'] === 225.0 && $sb['action'] === 'stay');
$wk->save($su, $doc($sg, 'legs', [[$squatS, 6, 10, [[225, 9], [225, 8], [225, 7]]]], $ago(2)));
check('one more rep at that weight is progress, so the usual planner carries on', $stallBlock()['stall'] === null);
$pu = $auth->createUser('progressor', 'progressor long password');
$pg = $mkGym($pu, 'Progress gym', Catalog::equipmentKeys());
$puser = $db->one('SELECT * FROM users WHERE id=?', [$pu]);
foreach ([[5, 205], [4, 215], [3, 225]] as [$d, $w]) {
    $wk->save($pu, $doc($pg, 'legs', [[$squatS, 6, 10, [[$w, 8], [$w, 8]]]], $ago($d)));
}
check('adding weight across sessions is not a stall', $gen->block($puser, $pg, $exById[$squatS])['stall'] === null);
$eu = $auth->createUser('easyrater', 'easyrater long password');
$eg = $mkGym($eu, 'Easy gym', Catalog::equipmentKeys());
$euser = $db->one('SELECT * FROM users WHERE id=?', [$eu]);
foreach ([5, 4, 3] as $d) {
    $ed = $doc($eg, 'legs', [[$squatS, 6, 10, [[225, 8], [225, 8]]]], $ago($d));
    $ed['exercises'][0]['reps_left'] = $d === 3 ? 4 : null;
    $wk->save($eu, $ed);
}
check('a "4+ reps left" rating on the latest session means it is not a stall', $gen->block($euser, $eg, $exById[$squatS])['stall'] === null);
// A long break is not a stall: the same weight a year ago, then fewer reps on coming back.
$bu = $auth->createUser('comeback', 'comeback long password');
$bg = $mkGym($bu, 'Comeback gym', Catalog::equipmentKeys());
$buser = $db->one('SELECT * FROM users WHERE id=?', [$bu]);
foreach ([[357, [[225, 8], [225, 8], [225, 8]]], [346, [[225, 8], [225, 8]]], [2, [[225, 6], [225, 6], [225, 6]]]] as [$d, $sets]) {
    $wk->save($bu, $doc($bg, 'legs', [[$squatS, 8, 12, $sets]], $ago($d)));
}
check('sessions a year apart are a comeback, not a stall', $gen->block($buser, $bg, $exById[$squatS])['stall'] === null);
foreach ([4, 3] as $d) {
    $wk->save($bu, $doc($bg, 'legs', [[$squatS, 8, 12, [[225, 6], [225, 6], [225, 6]]]], $ago($d)));
}
check('three close sessions after the break can still be a stall', ($gen->block($buser, $bg, $exById[$squatS])['stall']['sessions'] ?? 0) === 3);
check('a stall only counts while it is recent: nothing to report a month later', $gen->stall($bu, Catalog::variantKey($squatS, $exById[$squatS]['kind'], $bg['id']), 8, 12, 5.0, 'lb', time() + 30 * 86400) === null);
$chicago = new DateTimeZone('America/Chicago');
check('days since a workout count calendar days where the lifter is (Sunday evening to Tuesday afternoon is 2)', Generator::daysBetween(strtotime('2026-11-16T02:00:00Z'), strtotime('2026-11-17T22:24:00Z'), $chicago) === 2 && Generator::daysBetween(strtotime('2026-11-16T02:00:00Z'), strtotime('2026-11-17T22:24:00Z'), new DateTimeZone('UTC')) === 1);

echo "Effort ratings plan the next workout (#198)\n";
// Lifters with the same two push workouts, rated differently (or not at all).
$effortUser = function (string $name, ?string $effort, bool $rated, array $doneShort = []) use ($auth, $mkGym, $doc, $wk, $db, $bySlug, $ago) {
    $id = $auth->createUser($name, "$name long password");
    $gym = $mkGym($id, 'Effort gym', Catalog::equipmentKeys());
    foreach ([12, 10] as $i => $d) {
        $w = $doc($gym, 'push', [[$bySlug['barbell-bench-press'], 6, 10, [[135, 10], [135, 10], [135, 10]]], [$bySlug['machine-chest-press'], 8, 12, [[100, 12], [100, 12], [100, 12]]]], $ago($d));
        if (in_array($i, $doneShort, true)) {
            $w['exercises'][0]['target_sets'] = 4; // planned 4, did 3
        }
        $w['effort'] = $effort;
        $w['effort_rated'] = $rated;
        $wk->save($id, $w);
    }
    return [$db->one('SELECT * FROM users WHERE id=?', [$id]), $gym];
};
$plan = fn(array $u) => $gen->generate($u[0], $u[1], ['day_type' => 'push', 'minutes' => 90, 'now' => time()]);
$sets = fn(array $p) => array_column(array_filter($p['exercises'], static fn($b) => $b['kind'] !== 'cardio' && $b['kind'] !== 'stretch'), 'target_sets', 'exercise_id');
$weights = fn(array $p) => array_column($p['exercises'], 'suggested_weight', 'exercise_id');
$base = $plan($effortUser('effort-none', 'hard', false));
$hard = $plan($effortUser('effort-hard', 'hard', true));
$light = $plan($effortUser('effort-light', 'light', true));
check('skipped (default-only) effort keeps the usual plan and says nothing', $base['effort_note'] === null);
check('two recent push workouts rated Hard plan fewer sets, never below 2', array_keys($sets($hard)) === array_keys($sets($base)) && array_sum($sets($hard)) < array_sum($sets($base)) && min($sets($hard)) >= 2, json_encode([$sets($hard), $sets($base)]));
check('the change is explained once, for the whole workout', $hard['effort_note'] === 'Your recent push workouts felt hard, so this one has fewer sets.', (string) $hard['effort_note']);
check('effort never changes a lift\'s weight or reps', $weights($hard) === $weights($base) && $weights($light) === $weights($base) && array_column($hard['exercises'], 'suggested_reps', 'exercise_id') === array_column($base['exercises'], 'suggested_reps', 'exercise_id'));
check('two Light ratings with every planned set done add a set to the main lifts', array_sum($sets($light)) > array_sum($sets($base)) && max($sets($light)) <= Generator::EFFORT_MAX_SETS && strpos((string) $light['effort_note'], 'felt light') !== false, json_encode([$sets($light), $sets($base)]));
check('Light on a session that missed planned sets adds nothing', $plan($effortUser('effort-light-short', 'light', true, [0]))['effort_note'] === null);
check('Moderate ratings use the usual rules', $plan($effortUser('effort-moderate', 'moderate', true))['effort_note'] === null);
$mixedU = $effortUser('effort-mixed', 'hard', true);
$db->run("UPDATE workouts SET effort='light' WHERE id=?", [$wk->history((int) $mixedU[0]['id'])[0]['id']]);
check('mixed recent ratings use the usual rules', $plan($mixedU)['effort_note'] === null);
$hardU = $effortUser('effort-hard-legs', 'hard', true);
check('ratings only count for the same kind of workout', $gen->generate($hardU[0], $hardU[1], ['day_type' => 'legs', 'minutes' => 90, 'now' => time()])['effort_note'] === null);
check('picked-muscle workouts are not adjusted', $gen->generate($hardU[0], $hardU[1], ['day_type' => 'custom', 'muscles' => ['chest'], 'minutes' => 90, 'now' => time()])['effort_note'] === null);
check('ratings older than 4 weeks are ignored', $gen->generate($hardU[0], $hardU[1], ['day_type' => 'push', 'minutes' => 90, 'now' => time() + 30 * 86400])['effort_note'] === null);
$latestOf = fn(string $name) => (function () use ($wk, $db, $name) {
    $id = (int) $db->val('SELECT id FROM users WHERE username=?', [$name]);
    return $wk->get($id, $wk->history($id)[0]['id']);
})();
check('whether the effort was chosen comes back with the workout', $latestOf('effort-hard')['effort_rated'] === true && $latestOf('effort-none')['effort_rated'] === false && $latestOf('effort-none')['effort'] === 'hard');

echo "Other goals (#192)\n";
$goalUser = function (string $name, string $goal) use ($auth, $mkGym, $db) {
    $id = $auth->createUser($name, "$name long password");
    $db->run('UPDATE users SET goal=? WHERE id=?', [$goal, $id]);
    return [$db->one('SELECT * FROM users WHERE id=?', [$id]), $mkGym($id, 'Goal gym', Catalog::equipmentKeys())];
};
$lifts = fn(array $p) => array_values(array_filter($p['exercises'], static fn($b) => !in_array($b['kind'], ['cardio', 'stretch'], true)));
$slugOf = fn(int $id) => (string) $db->val('SELECT slug FROM exercises WHERE id=?', [$id]);
check('the three new goals are valid goals', isset(Generator::GOALS['starter'], Generator::GOALS['weight_loss'], Generator::GOALS['powerlifting']));
[$su, $sg] = $goalUser('goal-starter', 'starter');
$sp = $lifts($gen->generate($su, $sg, ['day_type' => 'push', 'minutes' => 60]));
check('Get started: at most 2 sets per lift and 6-8 reps on main lifts', $sp && max(array_column($sp, 'target_sets')) <= 2 && in_array([6, 8], array_map(static fn($b) => [$b['rep_min'], $b['rep_max']], $sp), true), json_encode(array_map(static fn($b) => [$b['name'], $b['target_sets'], $b['rep_min'], $b['rep_max']], $sp)));
check('Get started: only machines, cables, dumbbells, bodyweight or bands', array_filter($sp, static fn($b) => !in_array($b['kind'], Generator::STARTER_KINDS, true)) === [], json_encode(array_column($sp, 'kind')));
$beginner = function (array $p) use ($slugOf, $lifts) {
    $bad = [];
    foreach ($lifts($p) as $b) {
        $slug = $slugOf($b['exercise_id']);
        if (!in_array($slug, array_merge(...array_values(Generator::STARTER_LIFTS)), true)) {
            $bad[] = $slug;
        }
    }
    return $bad;
};
$starterPlans = array_map(fn($d) => $gen->generate($su, $sg, ['day_type' => $d, 'minutes' => 60]), ['push', 'pull', 'legs', 'upper', 'lower', 'full']);
$badLifts = array_merge(...array_map($beginner, $starterPlans));
check('Get started: every lift on every workout type is on the beginner list (no pull-ups, hanging leg raises, lunges, deadlifts)', $badLifts === [], json_encode($badLifts));
check('Get started: at most 5 lifts in a session', max(array_map(fn($p) => count($lifts($p)), $starterPlans)) <= Generator::STARTER_MAX_LIFTS, json_encode(array_map(fn($p) => count($lifts($p)), $starterPlans)));
check('Get started: the easiest option leads, e.g. the machine chest press on Push and the lat pulldown on Pull', $slugOf($lifts($starterPlans[0])[0]['exercise_id']) === 'machine-chest-press' && $slugOf($lifts($starterPlans[1])[0]['exercise_id']) === 'lat-pulldown');
$bwStarter = $gen->generate($su, $sg, ['day_type' => 'legs', 'minutes' => 45, 'bodyweight_only' => true]);
check('Get started with bodyweight only still sticks to beginner moves', $beginner($bwStarter) === [] && count($lifts($bwStarter)) > 0, json_encode(array_column($lifts($bwStarter), 'name')));
[$wu, $wg] = $goalUser('goal-weight', 'weight_loss');
$wp = $lifts($gen->generate($wu, $wg, ['day_type' => 'legs', 'minutes' => 60]));
check('Reduce bodyweight: 12+ reps and short rests', $wp && min(array_column($wp, 'rep_min')) >= 12 && max(array_column($wp, 'rest_seconds')) <= 45, json_encode(array_map(static fn($b) => [$b['rep_min'], $b['rest_seconds']], $wp)));
[$pu, $pg] = $goalUser('goal-power', 'powerlifting');
$pp = fn(string $day) => array_map(static fn($b) => $b, $lifts($gen->generate($pu, $pg, ['day_type' => $day, 'minutes' => 75])));
$push = $pp('push');
$pull = $pp('pull');
$legs = $pp('legs');
$lower = $pp('lower');
check('Powerlifting: Push starts with the barbell bench press, 3-5 reps', $slugOf($push[0]['exercise_id']) === 'barbell-bench-press' && $push[0]['rep_min'] === 3 && $push[0]['rep_max'] === 5, $push[0]['name']);
check('Powerlifting: Pull leads with the deadlift', $slugOf($pull[0]['exercise_id']) === 'deadlift', $pull[0]['name']);
check('Powerlifting: Legs has the back squat and a Romanian deadlift, not a second heavy deadlift', in_array('back-squat', array_map(static fn($b) => $slugOf($b['exercise_id']), $legs), true) && in_array('romanian-deadlift', array_map(static fn($b) => $slugOf($b['exercise_id']), $legs), true) && !in_array('deadlift', array_map(static fn($b) => $slugOf($b['exercise_id']), $legs), true));
check('Powerlifting: Lower body has the squat and the deadlift', count(array_intersect(['back-squat', 'deadlift'], array_map(static fn($b) => $slugOf($b['exercise_id']), $lower))) === 2);
check('Powerlifting says why the competition lift is there', strpos($push[0]['reason'], 'competition lift') !== false, $push[0]['reason']);
$dbOnly = $mkGym((int) $pu['id'], 'Dumbbells only', ['dumbbells', 'bench']);
$dpush = $lifts($gen->generate($pu, $dbOnly, ['day_type' => 'push', 'minutes' => 60]));
check('Powerlifting without a barbell uses the closest variation', $slugOf($dpush[0]['exercise_id']) === 'dumbbell-bench-press' && strpos($dpush[0]['reason'], 'closest to the competition lift') !== false, $dpush[0]['name'] . ' / ' . $dpush[0]['reason']);
$plain = $lifts($gen->generate($pu, $pg, ['day_type' => 'custom', 'muscles' => ['chest'], 'minutes' => 45]));
check('picked-muscle days keep their own rules for powerlifting too', $plain !== []);

echo "Exercise variety (#211)\n";
$varUser = function (string $name, string $variety, string $goal = 'muscle') use ($auth, $mkGym, $db) {
    $id = $auth->createUser($name, "$name long password");
    $db->run('UPDATE users SET variety=?, goal=? WHERE id=?', [$variety, $goal, $id]);
    return [$db->one('SELECT * FROM users WHERE id=?', [$id]), $mkGym($id, 'Variety gym', Catalog::equipmentKeys())];
};
// Finish a generated plan as planned, $daysAgo days back.
$doPlan = function (array $u, array $plan, int $daysAgo) use ($wk, $ago) {
    $when = $ago($daysAgo);
    $exs = [];
    foreach ($plan['exercises'] as $b) {
        if (in_array($b['kind'], ['cardio', 'stretch'], true)) {
            continue;
        }
        $sets = [];
        for ($i = 0; $i < $b['target_sets']; $i++) {
            $sets[] = ['id' => uuid(), 'weight' => $b['suggested_weight'] ?? 50, 'reps' => $b['rep_max'], 'warmup' => false, 'done' => true, 'done_at' => $when];
        }
        $exs[] = ['id' => uuid(), 'exercise_id' => $b['exercise_id'], 'rep_min' => $b['rep_min'], 'rep_max' => $b['rep_max'], 'target_sets' => $b['target_sets'], 'sets' => $sets];
    }
    $wk->save((int) $u[0]['id'], ['id' => uuid(), 'gym_id' => $u[1]['id'], 'day_type' => $plan['day_type'], 'status' => 'completed', 'unit' => 'lb', 'started_at' => $when, 'completed_at' => $when, 'rev' => 1, 'exercises' => $exs]);
};
$bySlot = function (array $p) {
    $out = array_column(array_filter($p['exercises'], static fn($b) => !in_array($b['kind'], ['cardio', 'stretch'], true)), 'exercise_id', 'slot');
    ksort($out);
    return $out;
};
$gen2 = fn(array $u, string $day, array $opts = []) => $gen->generate($u[0], $u[1], ['day_type' => $day, 'minutes' => 90, 'now' => time()] + $opts);
// Every lift sits in a slot that accepts its movement (no Pull or Legs lifts on Push, etc).
$fits = function (array $p) use ($exById, $db) {
    $slots = [];
    foreach (Generator::TEMPLATES[$p['day_type']] as $slot) {
        $slots[$slot[0]] = $slot[1];
    }
    $slots['deadlift'] = ['hinge'];
    foreach ($p['exercises'] as $b) {
        if (in_array($b['kind'], ['cardio', 'stretch'], true)) {
            continue;
        }
        if (!in_array($db->val('SELECT pattern FROM exercises WHERE id=?', [$b['exercise_id']]), $slots[$b['slot']] ?? [], true)) {
            return false;
        }
    }
    return true;
};
check('Mixed is the default for every account', $db->val('SELECT variety FROM users WHERE id=?', [$uid]) === 'mixed' && isset(Generator::VARIETY['steady'], Generator::VARIETY['varied']));
$steadyU = $varUser('var-steady', 'steady');
$mixedU = $varUser('var-mixed', 'mixed');
foreach ([$steadyU, $mixedU] as $u) {
    $doPlan($u, $gen2($u, 'push'), 9);
}
$s1 = $bySlot($gen2($steadyU, 'push'));
$m0 = $bySlot($gen2($mixedU, 'push'));
$doPlan($steadyU, $gen2($steadyU, 'push'), 5);
$doPlan($mixedU, $gen2($mixedU, 'push'), 5);
$s2 = $bySlot($gen2($steadyU, 'push'));
$m1 = $gen2($mixedU, 'push');
check('Steady repeats the same lifts session to session', $s1 === $s2, json_encode([$s1, $s2]));
check('Mixed keeps the main lifts (flat press, overhead press)', $bySlot($m1)['press'] === $m0['press'] && $bySlot($m1)['overhead'] === $m0['overhead']);
check('Mixed rotates the supporting lifts between sessions', count(array_diff_assoc(array_diff_key($bySlot($m1), ['press' => 1, 'overhead' => 1]), array_diff_key($m0, ['press' => 1, 'overhead' => 1]))) > 0, json_encode([$m0, $bySlot($m1)]));
check('a rotated lift says why', (bool) array_filter($m1['exercises'], static fn($b) => strpos($b['reason'], 'Rotated in for variety') === 0));
check('rotation never brings in a lift from outside the workout type', $fits($m1) && $fits($gen2($mixedU, 'pull')) && $fits($gen2($mixedU, 'legs')));
$variedU = $varUser('var-varied', 'varied');
$first = $bySlot($gen2($variedU, 'push'));
foreach ([12, 9, 6] as $d) {
    $doPlan($variedU, $gen2($variedU, 'push'), $d);
}
$v4 = $bySlot($gen2($variedU, 'push'));
check('Varied also rotates a main lift once it has led three sessions in a row', $v4['press'] !== $first['press'] || $v4['overhead'] !== $first['overhead'], json_encode([$first, $v4]));
$plU = $varUser('var-power', 'varied', 'powerlifting');
foreach ([12, 9, 6] as $d) {
    $doPlan($plU, $gen2($plU, 'push'), $d);
}
check('Powerlifting keeps the bench press on Varied', $slugOf($bySlot($gen2($plU, 'push'))['press']) === 'barbell-bench-press');
$stU = $varUser('var-starter', 'mixed', 'starter');
$doPlan($stU, $gen2($stU, 'push'), 6);
$stPlan = array_filter($gen2($stU, 'push')['exercises'], static fn($b) => !in_array($b['kind'], ['cardio', 'stretch'], true));
check('Get Started stays on its beginner lifts whatever the Variety setting', array_filter($stPlan, static fn($b) => !in_array($slugOf($b['exercise_id']), array_merge(...array_values(Generator::STARTER_LIFTS)), true)) === []);
// Regenerate walks down the list: keep rejecting the flat press.
$regU = $varUser('var-regen', 'mixed');
$seen = [];
$avoidList = [];
for ($i = 0; $i < 6; $i++) {
    $p = $bySlot($gen2($regU, 'push', ['avoid' => $avoidList]));
    $seen[] = $p['press'];
    $avoidList = array_values(array_unique(array_merge($avoidList, array_values($p))));
}
check('Regenerate shows a new flat press each time instead of flipping between two', count(array_unique($seen)) === count($seen), json_encode($seen));
$pressCount = count(array_filter($exById, static fn($e) => $e['pattern'] === 'horizontal_push'));
$all = array_values(array_filter(array_map(static fn($e) => $e['pattern'] === 'horizontal_push' ? $e['id'] : null, $exById)));
$wrap = $bySlot($gen2($regU, 'push', ['avoid' => array_merge($all, [-1])]));
check('once every option has been rejected, it starts again from the earliest rejected', $wrap['press'] === $all[0], json_encode([$wrap['press'], $all[0]]));

echo "Trends: range, pins and muscle details (#184, #126, #166)\n";
$tu = $auth->createUser('trend-batch', 'trend batch password');
$tg = $mkGym($tu, 'Trends gym', Catalog::equipmentKeys());
check('Trends defaults to 8 weeks and builds exactly the chosen range', count($wk->weeklyTrends($tu, 'lb', 'UTC')) === 8 && count($wk->weeklyTrends($tu, 'lb', 'UTC', null, 52)) === 52 && count($wk->weeklyTrends($tu, 'lb', 'UTC', null, 5)) === 5);
check('a range that is not offered falls back to 8 weeks', count($wk->weeklyTrends($tu, 'lb', 'UTC', null, 1000)) === 8);
$wk->save($tu, $doc($tg, 'push', [[$bench, 6, 10, [[125, 8]]]], $ago(6)));
$wk->save($tu, $doc($tg, 'push', [[$bench, 6, 10, [[135, 8], [145, 6]]]], $ago(3)));
$wk->save($tu, $doc($tg, 'push', [[$press, 8, 12, [[100, 10]]]], $ago(1)));
$wk->setPin($tu, $bench, true);
$wk->setPin($tu, $press, true);
$wk->setPin($tu, $bench, true); // pinning twice is harmless
$pins = $wk->pins($tu);
check('pins come back in the order pinned, once each, with the latest result', array_column($pins, 'exercise_id') === [$bench, $press] && $pins[0]['last']['best'] === ['weight' => 145.0, 'reps' => 6], json_encode($pins[0]['last']['best'] ?? null));
check('each pin carries its recent sessions of the same setup, newest first, for its P1RM', count($pins[0]['recent']) === 2 && $pins[0]['recent'][0]['date'] === $pins[0]['last']['date'] && $pins[0]['recent'][0]['sets'] === $pins[0]['last']['sets'] && $pins[0]['recent'][1]['date'] < $pins[0]['recent'][0]['date'], json_encode($pins[0]['recent']));
check('machine pins name the gym, barbell pins do not', $pins[1]['last']['gym_name'] === 'Trends gym' && $pins[0]['last']['gym_name'] === null);
$more = array_slice(array_values(array_filter(array_keys($exById), static fn($id) => $id !== $bench && $id !== $press)), 0, 4);
foreach (array_slice($more, 0, 3) as $id) {
    $wk->setPin($tu, $id, true);
}
check('a sixth pin is refused until one is unpinned', count($wk->pins($tu)) === 5 && throws(fn() => $wk->setPin($tu, $more[3], true), 409));
$wk->setPin($tu, $bench, false);
$wk->setPin($tu, $more[3], true);
check('unpinning makes room for another', count($wk->pins($tu)) === 5 && !in_array($bench, array_column($wk->pins($tu), 'exercise_id'), true));
check('pinning an exercise that does not exist is refused', throws(fn() => $wk->setPin($tu, 999999, true), 404));
$last = $gen->muscleLast($tu);
check('each trained muscle knows its latest workout and the exercises in it that worked it', isset($last['chest']) && $last['chest']['exercises'] === ['Machine Chest Press'] && !isset($last['quads']), json_encode($last['chest'] ?? null));

echo "Calendar and planned days (#228)\n";
$cu = $auth->createUser('cal-user', 'calendar password');
$db->update('users', ['split_type' => 'ppl'], 'id=?', [$cu]);
$cg = $mkGym($cu, 'Cal gym', Catalog::equipmentKeys());
$cal = new TF\Calendar($db, $gen);
$cuser = fn() => $db->one('SELECT * FROM users WHERE id=?', [$cu]);
$tue = strtotime('2026-11-17T15:00:00Z'); // a Tuesday
$plans = function (array $m): array {
    $out = [];
    foreach ((array) $m['days'] as $day => $d) {
        if ($d['plan']) {
            $out[substr($day, 8)] = $d['plan']['short'];
        }
    }
    return $out;
};
$m = $cal->month($cuser(), '2026-11', 'UTC', $tue);
check('with no training days there is no plan, only the month', $m['has_plan'] === false && $plans($m) === [] && $m['today'] === '2026-11-17' && $m['month'] === '2026-11');
check('training days are stored as sorted weekdays, ignoring anything else', TF\Calendar::storeDays([4, 1, 'x', 9, 2, 1]) === '1,2,4' && TF\Calendar::storeDays([]) === null && TF\Calendar::parseDays('4,1,2') === [1, 2, 4]);
$db->update('users', ['training_days' => '1,2,4'], 'id=?', [$cu]); // Mon, Tue, Thu
$m = $cal->month($cuser(), '2026-11', 'UTC', $tue);
check('the split is planned onto the training days from today, starting with Push', $plans($m) === ['17' => 'Push', '19' => 'Pull', '23' => 'Legs', '24' => 'Push', '26' => 'Pull', '30' => 'Legs'], json_encode($plans($m)));
check('nothing is planned before today', !array_filter(array_keys($plans($m)), static fn($d) => $d < '17'));
$wk->save($cu, $doc($cg, 'push', [[$bench, 6, 10, [[135, 8]]]], '2026-11-16T15:00:00Z'));
$m = $cal->month($cuser(), '2026-11', 'UTC', $tue);
$d16 = ((array) $m['days'])['2026-11-16'];
check('a finished workout shows on its day with its day type, and the plan carries on from it', count($d16['done']) === 1 && $d16['done'][0]['short'] === 'Push' && $d16['done'][0]['label'] === 'Push' && $plans($m)['17'] === 'Pull' && $plans($m)['19'] === 'Legs', json_encode($plans($m)));
$thu = strtotime('2026-11-19T15:00:00Z');
$m = $cal->month($cuser(), '2026-11', 'UTC', $thu);
check('a missed day is not lost: Pull moves to the next training day and the rest shift', $plans($m) === ['19' => 'Pull', '23' => 'Legs', '24' => 'Push', '26' => 'Pull', '30' => 'Legs'], json_encode($plans($m)));
$wk->save($cu, $doc($cg, 'pull', [[$bench, 6, 10, [[135, 8]]]], '2026-11-17T14:00:00Z'));
$m = $cal->month($cuser(), '2026-11', 'UTC', $tue);
check('once today is trained, today is not planned again and the next day type moves on', !isset($plans($m)['17']) && $plans($m)['19'] === 'Legs' && $plans($m)['23'] === 'Push', json_encode($plans($m)));
$cal->setDay($cuser(), '2026-11-19', 'rest', 'UTC', $tue);
$m = $cal->month($cuser(), '2026-11', 'UTC', $tue);
check('resting a planned day pushes everything back one training day', !isset($plans($m)['19']) && $plans($m)['23'] === 'Legs' && $plans($m)['24'] === 'Push' && ((array) $m['days'])['2026-11-19']['override'] === 'rest', json_encode($plans($m)));
$cal->setDay($cuser(), '2026-11-19', 'clear', 'UTC', $tue);
$cal->setDay($cuser(), '2026-11-19', 'move', 'UTC', $tue);
$m = $cal->month($cuser(), '2026-11', 'UTC', $tue);
check('moving a day trains the next day instead', !isset($plans($m)['19']) && $plans($m)['20'] === 'Legs' && $plans($m)['23'] === 'Push', json_encode($plans($m)));
$cal->setDay($cuser(), '2026-11-19', 'clear', 'UTC', $tue);
$cal->setDay($cuser(), '2026-11-20', 'clear', 'UTC', $tue);
$cal->setDay($cuser(), '2026-11-21', 'train', 'UTC', $tue);
$m = $cal->month($cuser(), '2026-11', 'UTC', $tue);
check('an extra training day takes the next day type', $plans($m) === ['19' => 'Legs', '21' => 'Push', '23' => 'Pull', '24' => 'Legs', '26' => 'Push', '30' => 'Pull'], json_encode($plans($m)));
check('past days and non-dates cannot be changed', throws(fn() => $cal->setDay($cuser(), '2026-11-16', 'rest', 'UTC', $tue), 422) && throws(fn() => $cal->setDay($cuser(), '2026-02-30', 'rest', 'UTC', $tue), 422) && throws(fn() => $cal->setDay($cuser(), '2026-11-19', 'nap', 'UTC', $tue), 422));
$m = $cal->month($cuser(), '2026-12', 'UTC', $tue);
check('later months carry the plan on', ($plans($m)['01'] ?? null) === 'Legs' && count($plans($m)) === 14, json_encode($plans($m)));
$m = $cal->month($cuser(), '2026-11', 'UTC', strtotime('2026-11-25T15:00:00Z'));
check('changes to days that have passed are cleared away', (int) $db->val('SELECT COUNT(*) FROM schedule_overrides WHERE user_id=?', [$cu]) === 0);
$wk->save($cu, $doc($cg, 'legs', [[$bench, 6, 10, [[135, 8]]]], '2026-11-11T03:00:00Z'));
$m = $cal->month($cuser(), '2026-11', 'America/Chicago', $tue);
check('a workout counts on the day it started where the person is (late evening in Chicago)', isset(((array) $m['days'])['2026-11-10']) && !isset(((array) $m['days'])['2026-11-11']));
check('a bad month falls back to this month', $cal->month($cuser(), 'nope', 'UTC', $tue)['month'] === '2026-11');

unset($db);
@unlink($file);
@unlink($file . '-wal');
@unlink($file . '-shm');

echo "\n$pass passed, $fail failed\n";
exit($fail ? 1 : 0);
