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

echo "Account requests\n";
$reqDb = $freshDb('requests');
Migrator::ensure($reqDb);
$ra = new Auth($reqDb, []);
$boss = $ra->createUser('boss', 'boss-password-123');
check('requests are closed until the admin sets a token', $ra->inviteStatus()['set'] === false && throws(fn() => $ra->requestAccount('anything-at-all', 'eve', 'eve-password-123'), 403));
check('a token that is too short is refused', throws(fn() => $ra->setInviteToken('short'), 422));
$ra->setInviteToken('gym-crew-2026');
$stored = $reqDb->val("SELECT value FROM app_settings WHERE name='invite_token_hash'");
check('the invite token is stored hashed, never as typed', $ra->inviteStatus()['set'] === true && strpos($stored, 'gym-crew') === false && password_verify('gym-crew-2026', $stored));
check('a wrong token is refused before anything is created', throws(fn() => $ra->requestAccount('not-the-token', 'eve', 'eve-password-123'), 403) && (int) $reqDb->val('SELECT COUNT(*) FROM users') === 1);
$rid = $ra->requestAccount(' gym-crew-2026 ', 'Dana', 'dana-own-password', 'Dana R');
$row = $reqDb->one('SELECT * FROM users WHERE id=?', [$rid]);
check('the right token creates a pending request as a regular user', $row['status'] === 'pending' && $row['role'] === 'user' && $row['username'] === 'dana');
check('the applicant\'s password is their own, separate from the invite token', password_verify('dana-own-password', $row['password_hash']) && !password_verify('gym-crew-2026', $row['password_hash']));
check('the invite token does not work as a sign-in password', throws(fn() => $ra->login('dana', 'gym-crew-2026'), 401));
check('a pending applicant cannot sign in yet', throws(fn() => $ra->login('dana', 'dana-own-password'), 403) && (int) $reqDb->val('SELECT COUNT(*) FROM auth_sessions') === 0);
check('a wrong password for a pending account says nothing about the request', throws(fn() => $ra->login('dana', 'wrong-password-zz'), 401));
check('pending requests are listed apart from accounts', count($ra->pendingRequests()) === 1 && $ra->pendingRequests()[0]['username'] === 'dana' && count($ra->listUsers()) === 1 && !isset($ra->pendingRequests()[0]['password_hash']));
check('a requested username cannot be taken twice', throws(fn() => $ra->requestAccount('gym-crew-2026', 'dana', 'another-password-1'), 409) && throws(fn() => $ra->requestAccount('gym-crew-2026', 'boss', 'another-password-1'), 409));
check('the usual username and password rules apply to requests', throws(fn() => $ra->requestAccount('gym-crew-2026', 'x', 'long-enough-password'), 422) && throws(fn() => $ra->requestAccount('gym-crew-2026', 'okname', 'short'), 422));
$ra->approveRequest($rid);
$in = $ra->login('dana', 'dana-own-password');
check('after approval the applicant signs in with the password they chose, as a regular user', (int) $in['id'] === $rid && $in['role'] === 'user' && $in['status'] === 'active' && count($ra->listUsers()) === 2 && count($ra->pendingRequests()) === 0);
check('approving twice, or approving an existing account, does nothing', throws(fn() => $ra->approveRequest($rid), 404) && throws(fn() => $ra->approveRequest($boss), 404));
$rid2 = $ra->requestAccount('gym-crew-2026', 'mallory', 'mallory-password-1');
check('declining cannot remove a real account', throws(fn() => $ra->declineRequest($rid), 404) && throws(fn() => $ra->declineRequest($boss), 404) && (int) $reqDb->val('SELECT COUNT(*) FROM users') === 3);
$ra->declineRequest($rid2);
check('a declined request is deleted and cannot sign in', (int) $reqDb->val("SELECT COUNT(*) FROM users WHERE username='mallory'") === 0 && throws(fn() => $ra->login('mallory', 'mallory-password-1'), 401));
$ra->setInviteToken('brand-new-token');
check('changing the token stops the old one working', throws(fn() => $ra->requestAccount('gym-crew-2026', 'late', 'late-password-123'), 403));
$rid3 = $ra->requestAccount('brand-new-token', 'late', 'late-password-123');
$ra->setInviteToken('');
check('clearing the token closes requests but keeps the ones already waiting', $ra->inviteStatus()['set'] === false && throws(fn() => $ra->requestAccount('brand-new-token', 'later', 'later-password-12'), 403) && count($ra->pendingRequests()) === 1);
$ra->setInviteToken('third-token-here');
$reqDb->run("DELETE FROM login_attempts WHERE ident LIKE 'inv:%'");
for ($i = 0; $i < 5; $i++) {
    try {
        $ra->requestAccount('guess-' . $i . '-wrong', 'guesser', 'guesser-password');
    } catch (HttpError $e) {
    }
}
check('repeated wrong tokens are locked out for a while, even with the right one', throws(fn() => $ra->requestAccount('third-token-here', 'guesser', 'guesser-password'), 429));
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
            foreach ($exById[$b['exercise_id']]['equipment'] as $need) {
                if (!in_array($need, $gym['equipment'], true)) {
                    $violations[] = "{$gym['name']}/$day: {$b['name']} needs $need";
                }
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
    return array_diff($exById[$x['exercise_id']]['equipment'], $home['equipment']);
});
check('swap alternatives respect the gym too', (bool) $altOk);

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
$hs = $mkEx($adm, 'Hammerstrength Chest Press', TF\FitbodImport::slug('Hammerstrength Chest Press'));
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
check('existing workout history is untouched: same exercise id, same history key, same next suggestion (' . $after['suggested_weight'] . ' lb)', count($wkp->exerciseHistory($adm, $hs)) === 1 && $pdb->val('SELECT variant_key FROM workout_exercises WHERE exercise_id=?', [$hs]) === $keyBefore && $after['suggested_weight'] === $before['suggested_weight'] && $after['suggested_weight'] === 110.0 && $wkp->get($adm, $hist['id'])['exercises'][0]['name'] === 'Hammerstrength Chest Press');
$alts = array_column($genp->alternatives($pat, $og, (int) $pdb->val("SELECT id FROM exercises WHERE slug='machine-chest-press'")), 'exercise_id');
$patDoc = $doc($og, 'push', [[$hs, 6, 10, [[40, 8]]]], $ago(1));
check('other accounts can pick them, be offered them as alternatives, and log them', in_array($hs, $alts, true) && $wkp->save($pat, $patDoc)['ok'] === true && $genp->block($patRow, $og, $shapeOf($hs))['suggested_weight'] === 40.0);
check('each account keeps its own history for a moved exercise', count($wkp->exerciseHistory($pat, $hs)) === 1 && count($wkp->exerciseHistory($adm, $hs)) === 1);
check('an exercise whose name the default library already has stays the admin\'s own', $res['skipped'] === ['push-up'] && (int) $pdb->val('SELECT user_id FROM exercises WHERE id=?', [$clash]) === $adm);
check('other people\'s own exercises are left alone', (int) $pdb->val('SELECT user_id FROM exercises WHERE id=?', [$patOwn]) === $pat && !in_array($patOwn, $seenBy($adm), true));
$rowOf = fn(int $id) => $pdb->one('SELECT * FROM exercises WHERE id=?', [$id]);
check('the admin can still edit or archive a moved exercise; nobody else can, and built-in ones stay read-only', Catalog::canEdit($rowOf($hs), $admRow) && !Catalog::canEdit($rowOf($hs), $patRow) && !Catalog::canEdit($pdb->one("SELECT * FROM exercises WHERE slug='push-up'"), $admRow) && Catalog::canEdit($rowOf($patOwn), $patRow) && !Catalog::canEdit($rowOf($patOwn), $admRow));
check('moving again changes nothing', Catalog::promote($pdb, $adm)['promoted'] === 0 && (int) $pdb->val('SELECT COUNT(*) FROM exercises WHERE promoted_from IS NOT NULL') === 2);
$planned = (new TF\FitbodImport($pdb))->plan($pat, ['names' => ['Hammerstrength Chest Press' => ['sets' => 3, 'weighted' => true]]]);
check('a Fitbod import by another account uses the moved exercise instead of making a duplicate', $planned[0]['action'] === 'match' && $planned[0]['exercise_id'] === $hs);
Catalog::sync($pdb);
check('refreshing the built-in catalog leaves moved exercises in place', $pdb->val('SELECT name FROM exercises WHERE id=?', [$hs]) === 'Hammerstrength Chest Press' && (int) $pdb->val('SELECT COUNT(*) FROM exercises WHERE user_id IS NULL') === count(Catalog::exercises()) + 2);
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
check('unknown names become your own exercises with guessed tags', $byName['Cable Rope Tricep Extension']['action'] === 'new' && $byName['Cable Rope Tricep Extension']['guess'] === ['kind' => 'cable', 'equipment' => ['cable'], 'pattern' => 'triceps', 'muscles_main' => ['triceps'], 'muscles_assist' => []]);
check('a machine with no matching gym checkbox is never auto-suggested', $byName['Machine Preacher Curl']['guess']['pattern'] === 'other' && $byName['Barbell Shrug']['guess']['pattern'] === 'other');
$targets = array_filter(array_column($plan, 'exercise_id'));
check('no two Fitbod exercises are merged into one built-in', count($targets) === count(array_unique($targets)) && count(array_unique(FitbodImport::MAP)) === count(FitbodImport::MAP));
$missing = array_diff(FitbodImport::MAP, array_column(Catalog::exercises(), 0));
check('every mapped name points at a real catalog exercise', !$missing, implode(' ', $missing));
$res = $imp->run($uid3, $gym3, 'lb', $parsed, $plan);
check('import writes workouts, sets and new exercises', $res === ['workouts' => 2, 'sets' => 11, 'exercises_created' => 3]);
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

unset($db);
@unlink($file);
@unlink($file . '-wal');
@unlink($file . '-shm');

echo "\n$pass passed, $fail failed\n";
exit($fail ? 1 : 0);
