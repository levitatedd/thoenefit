<?php
declare(strict_types=1);

use TF\Catalog;
use TF\Db;
use TF\Migrator;

// Feedback #254: the Bulgarian Split Squat is done with a dumbbell in each hand, so it
// needs a dumbbell pair, not a single dumbbell. Catalog::sync updates built-ins by slug.
return static function (Db $db, Migrator $m): void {
    Catalog::sync($db);
};
