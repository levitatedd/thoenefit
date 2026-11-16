<?php
declare(strict_types=1);

use TF\Catalog;
use TF\Db;
use TF\Migrator;

// Stretches (#138): adds the built-in stretches (a new timed "stretch" kind,
// logged as seconds per hold) and remembers whether each account wants them
// in its plans. Catalog::sync updates by slug, so it never duplicates rows.
return static function (Db $db, Migrator $m): void {
    if (!$m->hasColumn('users', 'stretches')) {
        $db->pdo->exec('ALTER TABLE users ADD COLUMN stretches TINYINT NOT NULL DEFAULT 0');
    }
    Catalog::sync($db);
};
