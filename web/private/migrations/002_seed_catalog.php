<?php
declare(strict_types=1);

use TF\Catalog;
use TF\Db;
use TF\Migrator;

// Loads (or refreshes) the built-in exercise catalog. To ship catalog changes
// later, add a new migration that calls Catalog::sync() again.
return static function (Db $db, Migrator $m): void {
    Catalog::sync($db);
};
