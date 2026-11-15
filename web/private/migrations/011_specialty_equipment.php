<?php
declare(strict_types=1);

use TF\Catalog;
use TF\Db;
use TF\Migrator;

// Retags built-in exercises for the new specialty-gear and machine
// checkboxes (#69). Rows are updated in place, so history stays linked.
// Existing gym profiles keep their ticks; nobody gets the new gear until
// they tick it.
return static function (Db $db, Migrator $m): void {
    Catalog::sync($db);
};
