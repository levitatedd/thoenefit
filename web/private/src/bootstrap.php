<?php
declare(strict_types=1);

namespace TF;

const APP_VERSION = '1.0.0';

require_once __DIR__ . '/Db.php';
require_once __DIR__ . '/Migrator.php';
require_once __DIR__ . '/Catalog.php';
require_once __DIR__ . '/Auth.php';
require_once __DIR__ . '/Workouts.php';
require_once __DIR__ . '/Generator.php';
require_once __DIR__ . '/FitbodImport.php';
require_once __DIR__ . '/Shares.php';
require_once __DIR__ . '/Routines.php';
require_once __DIR__ . '/Strava.php';
require_once __DIR__ . '/StravaStrength.php';
require_once __DIR__ . '/Api.php';

final class HttpError extends \RuntimeException
{
    public int $status;

    public function __construct(int $status, string $message)
    {
        parent::__construct($message);
        $this->status = $status;
    }
}

/** The folder the web server serves (the one holding api.php). */
function web_root(): string
{
    return dirname(__DIR__, 2);
}

/**
 * The staging site requires thoenefit-staging-config.php above its web root.
 * Other sites read config from, in order:
 *   1. the path in the THOENEFIT_CONFIG environment variable
 *   2. thoenefit-config.php in the folder ABOVE the web folder (never served)
 * With no config, the command line and PHP's built-in dev server fall back to
 * a local SQLite file so the app runs with zero setup. A real web server
 * without a config file refuses to start.
 */
function load_config(): array
{
    $root = web_root();
    $home = dirname($root);
    $staging = basename($root) === 'fit-test.mikethoene.com';
    if ($staging) {
        $candidates = [$home . '/thoenefit-staging-config.php'];
    } else {
        $env = getenv('THOENEFIT_CONFIG');
        $candidates = $env ? [$env, $home . '/thoenefit-config.php'] : [$home . '/thoenefit-config.php'];
    }
    foreach ($candidates as $file) {
        if (is_file($file)) {
            $cfg = require $file;
            if (!is_array($cfg) || empty($cfg['db'])) {
                throw new \RuntimeException("Config file $file must return an array with a 'db' entry.");
            }
            $cfg['_source'] = $file;
            return $cfg;
        }
    }
    if (!$staging && (PHP_SAPI === 'cli' || PHP_SAPI === 'cli-server')) {
        $dir = $home . '/data';
        if (!is_dir($dir)) {
            mkdir($dir, 0700, true);
        }
        return [
            'db' => ['driver' => 'sqlite', 'path' => $dir . '/thoenefit.sqlite'],
            '_source' => 'local default (SQLite at ' . $dir . '/thoenefit.sqlite)',
        ];
    }
    throw new \RuntimeException(
        'ThoeneFit config not found. Copy config.example.php to ' . $candidates[count($candidates) - 1] . ' and fill it in.'
    );
}

function now_utc(?int $ts = null): string
{
    return gmdate('Y-m-d H:i:s', $ts ?? time());
}

/** Accepts ISO-8601 or "Y-m-d H:i:s" (treated as UTC); returns "Y-m-d H:i:s" UTC or null. */
function norm_time($value): ?string
{
    if (!is_string($value) || $value === '') {
        return null;
    }
    if (preg_match('/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/', $value)) {
        return $value;
    }
    try {
        $dt = new \DateTimeImmutable($value, new \DateTimeZone('UTC'));
    } catch (\Throwable $e) {
        return null;
    }
    return $dt->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s');
}

function to_iso(?string $utc): ?string
{
    return $utc ? str_replace(' ', 'T', $utc) . 'Z' : null;
}

function is_uuid($v): bool
{
    return is_string($v) && preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $v) === 1;
}

final class App
{
    public Db $db;
    public array $config;

    public function __construct(array $config)
    {
        $this->config = $config;
        $this->db = new Db($config['db']);
    }

    public static function boot(): App
    {
        $app = new App(load_config());
        Migrator::ensure($app->db);
        return $app;
    }
}
