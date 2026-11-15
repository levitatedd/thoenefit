<?php
declare(strict_types=1);

use TF\Catalog;
use TF\Db;
use TF\FitbodImport;
use TF\Migrator;

// Adds the built-in exercises for common Fitbod names (#65). Exercises an
// earlier import created for those names become the built-ins in place, so
// they keep their ids and history instead of being duplicated.
return static function (Db $db, Migrator $m): void {
    $db->tx(static function (Db $db): void {
        FitbodImport::adoptForBuiltins($db);
        Catalog::sync($db);
    });
};
