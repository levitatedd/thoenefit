<?php
declare(strict_types=1);

use TF\Db;
use TF\Migrator;

// Account requests. A request is a user row with status 'pending' that cannot
// sign in until the admin approves it. Everyone who already has an account
// stays 'active'. app_settings holds the hashed invite token.
return static function (Db $db, Migrator $m): void {
    if (!$m->hasColumn('users', 'status')) {
        $db->pdo->exec("ALTER TABLE users ADD COLUMN status VARCHAR(10) NOT NULL DEFAULT 'active'");
    }
    $m->table('app_settings', '
        name VARCHAR(64) NOT NULL PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at VARCHAR(19) NOT NULL
    ');
};
