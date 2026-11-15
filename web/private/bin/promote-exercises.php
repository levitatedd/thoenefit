<?php
declare(strict_types=1);

// Move one account's own ("Yours") exercises into the default library for
// everyone. Workout history is kept: the exercises keep their ids.
//   php promote-exercises.php <username>
// The database migration already did this once for the admin. Run this to do
// it again later, for example after importing more exercises.

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . '/src/bootstrap.php';

use TF\App;
use TF\Auth;
use TF\Catalog;

if (count($argv) < 2) {
    fwrite(STDERR, "Usage: php promote-exercises.php <username>\n");
    exit(1);
}
$app = App::boot();
fwrite(STDERR, 'Database: ' . ($app->config['_source'] ?? 'unknown') . "\n");
$id = $app->db->val('SELECT id FROM users WHERE username=?', [Auth::normUsername($argv[1])]);
if (!$id) {
    fwrite(STDERR, "No account named {$argv[1]}.\n");
    exit(1);
}
$r = Catalog::promote($app->db, (int) $id);
echo "Moved {$r['promoted']} exercise(s) into the default library.\n";
if ($r['skipped']) {
    echo "Left as that account's own, because the default library already has one with the same name:\n  " . implode("\n  ", $r['skipped']) . "\n";
}
