<?php
declare(strict_types=1);

use TF\Db;
use TF\Migrator;

return static function (Db $db, Migrator $m): void {
    if (!$m->hasColumn('strava_exports', 'upload_id')) {
        $db->pdo->exec('ALTER TABLE strava_exports ADD COLUMN upload_id VARCHAR(24) NULL');
    }
    if (!$m->hasColumn('strava_exports', 'poll_after')) {
        $db->pdo->exec('ALTER TABLE strava_exports ADD COLUMN poll_after BIGINT NOT NULL DEFAULT 0');
    }
};
