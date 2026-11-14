<?php
declare(strict_types=1);

use TF\Db;
use TF\Migrator;

// Adds account roles. Everyone starts as a regular user; the earliest-created
// account becomes the admin, who can create accounts from the app.
return static function (Db $db, Migrator $m): void {
    if (!$m->hasColumn('users', 'role')) {
        $db->pdo->exec("ALTER TABLE users ADD COLUMN role VARCHAR(10) NOT NULL DEFAULT 'user'");
    }
    if (!$db->val("SELECT COUNT(*) FROM users WHERE role='admin'")) {
        $first = $db->val('SELECT id FROM users ORDER BY created_at, id LIMIT 1');
        if ($first) {
            $db->run("UPDATE users SET role='admin' WHERE id=?", [$first]);
        }
    }
};
