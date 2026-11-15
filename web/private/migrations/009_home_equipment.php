<?php
declare(strict_types=1);

use TF\Catalog;
use TF\Db;
use TF\Migrator;

// Refresh existing exercise rows in place so their workout history stays linked.
return static function (Db $db, Migrator $m): void {
    Catalog::sync($db);
};
