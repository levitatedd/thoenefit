<?php
declare(strict_types=1);

// Apply pending database migrations. The app also does this on its own the
// first time it is opened after a deploy, so running this by hand is optional.
//   php migrate.php

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . '/src/bootstrap.php';

use TF\Db;
use TF\Migrator;

$config = TF\load_config();
fwrite(STDERR, 'Database: ' . ($config['_source'] ?? 'unknown') . "\n");
$db = new Db($config['db']);
$applied = Migrator::ensure($db);
echo $applied ? 'Applied migration(s): ' . implode(', ', $applied) . "\n" : "Database is up to date.\n";
echo 'Schema version: ' . Migrator::current($db) . "\n";
