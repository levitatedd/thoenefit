<?php
declare(strict_types=1);

use TF\Catalog;
use TF\Db;
use TF\Migrator;

// Moves the admin's own ("Yours") exercises into the default library, so every
// account can see, pick and be suggested them. The rows keep their ids, so
// every workout that used them still points at the same exercise and its
// history, trends and progression are untouched. promoted_from records whose
// exercise it was.
return static function (Db $db, Migrator $m): void {
    if (!$m->hasColumn('exercises', 'promoted_from')) {
        $db->pdo->exec('ALTER TABLE exercises ADD COLUMN promoted_from INT NULL');
    }
    $admin = $db->val("SELECT id FROM users WHERE role='admin' ORDER BY created_at, id LIMIT 1");
    if ($admin) {
        Catalog::promote($db, (int) $admin);
    }
};
