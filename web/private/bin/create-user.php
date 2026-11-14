<?php
declare(strict_types=1);

// Create an account, or reset a password.
//   php create-user.php <username> ["Display Name"]
//   php create-user.php --reset <username>
// The password is asked for interactively (or read from standard input when piped).

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . '/src/bootstrap.php';

use TF\App;
use TF\Auth;
use TF\HttpError;

$args = array_slice($argv, 1);
$reset = false;
if (($args[0] ?? '') === '--reset') {
    $reset = true;
    array_shift($args);
}
if (!$args) {
    fwrite(STDERR, "Usage: php create-user.php <username> [\"Display Name\"]\n       php create-user.php --reset <username>\n");
    exit(1);
}

function read_password(string $prompt): string
{
    $tty = function_exists('posix_isatty') && posix_isatty(STDIN);
    if ($tty) {
        fwrite(STDERR, $prompt);
        shell_exec('stty -echo 2>/dev/null');
    }
    $line = fgets(STDIN);
    if ($tty) {
        shell_exec('stty echo 2>/dev/null');
        fwrite(STDERR, "\n");
    }
    return rtrim((string) $line, "\r\n");
}

try {
    $app = App::boot();
    fwrite(STDERR, 'Database: ' . ($app->config['_source'] ?? 'unknown') . "\n");
    $auth = new Auth($app->db, $app->config);
    $username = Auth::normUsername($args[0]);
    $password = read_password('Password (10+ characters): ');
    if (function_exists('posix_isatty') && posix_isatty(STDIN)) {
        if ($password !== read_password('Repeat password: ')) {
            fwrite(STDERR, "Passwords do not match.\n");
            exit(1);
        }
    }
    if ($reset) {
        $id = $app->db->val('SELECT id FROM users WHERE username=?', [$username]);
        if (!$id) {
            fwrite(STDERR, "No account named $username.\n");
            exit(1);
        }
        $auth->setPassword((int) $id, $password);
        $auth->logoutEverywhere((int) $id);
        echo "Password updated for $username. All of their devices were signed out.\n";
    } else {
        $auth->createUser($username, $password, $args[1] ?? '');
        echo "Created account $username.\n";
    }
} catch (HttpError $e) {
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(1);
}
