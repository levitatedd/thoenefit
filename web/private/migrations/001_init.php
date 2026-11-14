<?php
declare(strict_types=1);

use TF\Db;
use TF\Migrator;

return static function (Db $db, Migrator $m): void {
    $m->table('users', '
        id {{PK}},
        username VARCHAR(64) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        display_name VARCHAR(100) NOT NULL,
        unit VARCHAR(2) NOT NULL DEFAULT \'lb\',
        goal VARCHAR(20) NOT NULL DEFAULT \'muscle\',
        experience VARCHAR(20) NOT NULL DEFAULT \'intermediate\',
        minutes INT NOT NULL DEFAULT 45,
        split_type VARCHAR(20) NOT NULL DEFAULT \'full\',
        active_gym_id INT NULL,
        onboarded TINYINT NOT NULL DEFAULT 0,
        created_at VARCHAR(19) NOT NULL
    ');
    $m->index('ux_users_username', 'users', 'username', true);

    $m->table('auth_sessions', '
        token_hash CHAR(64) NOT NULL PRIMARY KEY,
        user_id INT NOT NULL,
        csrf CHAR(32) NOT NULL,
        created_at VARCHAR(19) NOT NULL,
        last_seen VARCHAR(19) NOT NULL,
        expires_at VARCHAR(19) NOT NULL
    ');
    $m->index('ix_sessions_user', 'auth_sessions', 'user_id');

    $m->table('login_attempts', '
        id {{PK}},
        ident VARCHAR(120) NOT NULL,
        attempted_at VARCHAR(19) NOT NULL
    ');
    $m->index('ix_attempts_ident', 'login_attempts', 'ident, attempted_at');

    $m->table('gyms', '
        id {{PK}},
        user_id INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        equipment TEXT NOT NULL,
        increments TEXT NOT NULL,
        created_at VARCHAR(19) NOT NULL
    ');
    $m->index('ix_gyms_user', 'gyms', 'user_id');

    $m->table('exercises', '
        id {{PK}},
        user_id INT NULL,
        slug VARCHAR(80) NOT NULL,
        name VARCHAR(120) NOT NULL,
        kind VARCHAR(20) NOT NULL,
        equipment TEXT NOT NULL,
        pattern VARCHAR(30) NOT NULL,
        muscles_main TEXT NOT NULL,
        muscles_assist TEXT NOT NULL,
        cues TEXT NOT NULL,
        priority INT NOT NULL DEFAULT 5,
        archived TINYINT NOT NULL DEFAULT 0
    ');
    $m->index('ix_exercises_user', 'exercises', 'user_id');
    $m->index('ix_exercises_slug', 'exercises', 'slug');

    $m->table('workouts', '
        id CHAR(36) NOT NULL PRIMARY KEY,
        user_id INT NOT NULL,
        gym_id INT NULL,
        gym_name VARCHAR(100) NOT NULL,
        day_type VARCHAR(20) NOT NULL,
        status VARCHAR(12) NOT NULL,
        unit VARCHAR(2) NOT NULL,
        started_at VARCHAR(19) NOT NULL,
        completed_at VARCHAR(19) NULL,
        notes TEXT NULL,
        rev INT NOT NULL DEFAULT 1,
        updated_at VARCHAR(19) NOT NULL
    ');
    $m->index('ix_workouts_user_started', 'workouts', 'user_id, started_at');
    $m->index('ix_workouts_user_status', 'workouts', 'user_id, status');

    $m->table('workout_exercises', '
        id CHAR(36) NOT NULL PRIMARY KEY,
        workout_id CHAR(36) NOT NULL,
        user_id INT NOT NULL,
        exercise_id INT NOT NULL,
        variant_key VARCHAR(40) NOT NULL,
        pos INT NOT NULL,
        target_sets INT NOT NULL,
        rep_min INT NOT NULL,
        rep_max INT NOT NULL,
        rest_seconds INT NOT NULL DEFAULT 90,
        suggested_weight DECIMAL(8,2) NULL,
        reason TEXT NULL
    ');
    $m->index('ix_wex_workout', 'workout_exercises', 'workout_id');
    $m->index('ix_wex_user_variant', 'workout_exercises', 'user_id, variant_key');
    $m->index('ix_wex_user_exercise', 'workout_exercises', 'user_id, exercise_id');

    $m->table('workout_sets', '
        id CHAR(36) NOT NULL PRIMARY KEY,
        workout_exercise_id CHAR(36) NOT NULL,
        workout_id CHAR(36) NOT NULL,
        pos INT NOT NULL,
        weight DECIMAL(8,2) NULL,
        reps INT NULL,
        warmup TINYINT NOT NULL DEFAULT 0,
        done TINYINT NOT NULL DEFAULT 0,
        done_at VARCHAR(19) NULL
    ');
    $m->index('ix_sets_workout', 'workout_sets', 'workout_id');
    $m->index('ix_sets_wex', 'workout_sets', 'workout_exercise_id');
};
