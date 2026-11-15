<?php
declare(strict_types=1);

use TF\Db;
use TF\Migrator;

return static function (Db $db, Migrator $m): void {
    $m->table('strava_oauth_states', '
        nonce_hash CHAR(64) NOT NULL PRIMARY KEY,
        session_hash CHAR(64) NOT NULL,
        expires_at VARCHAR(19) NOT NULL
    ');
    $m->table('strava_connections', '
        user_id INT NOT NULL PRIMARY KEY,
        tokens TEXT NOT NULL,
        expires_at BIGINT NOT NULL
    ');
    $m->table('strava_exports', '
        user_id INT NOT NULL,
        workout_id CHAR(36) NOT NULL,
        activity_id VARCHAR(24) NULL,
        PRIMARY KEY (user_id, workout_id)
    ');
};
