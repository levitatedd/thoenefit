<?php
declare(strict_types=1);

use TF\Db;
use TF\Migrator;

// The "chatgpt" account is no longer needed, nor the rule that hid it from
// everyone but the admin when sharing (#36). Remove the account and everything
// it owns. Nothing happens where there is no such account, and an admin
// account is never removed. Its own exercises stay if anyone else has used
// them in a workout, so other people's history is untouched.
return static function (Db $db, Migrator $m): void {
    $user = $db->one("SELECT id, role FROM users WHERE username='chatgpt'");
    if (!$user || $user['role'] === 'admin') {
        return;
    }
    $id = (int) $user['id'];
    $db->run('DELETE FROM workout_sets WHERE workout_id IN (SELECT id FROM workouts WHERE user_id=?)', [$id]);
    foreach (['workout_exercises', 'workouts', 'gyms', 'routines', 'exercise_notes', 'exercise_pins', 'schedule_overrides', 'strava_connections', 'strava_exports', 'auth_sessions', 'feedback'] as $table) {
        $db->run("DELETE FROM $table WHERE user_id=?", [$id]);
    }
    $db->run('DELETE FROM workout_shares WHERE from_user=? OR to_user=?', [$id, $id]);
    foreach ($db->all('SELECT id FROM exercises WHERE user_id=?', [$id]) as $e) {
        $ex = (int) $e['id'];
        $used = $db->val('SELECT 1 FROM workout_exercises WHERE exercise_id=?', [$ex]);
        if (!$used) {
            $db->run('DELETE FROM exercises WHERE id=?', [$ex]);
        }
    }
    $db->run("DELETE FROM login_attempts WHERE ident='u:chatgpt'");
    $db->run('DELETE FROM users WHERE id=?', [$id]);
};
