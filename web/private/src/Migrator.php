<?php
declare(strict_types=1);

namespace TF;

/**
 * Numbered migrations live in private/migrations as NNN_name.php, each
 * returning function (Db $db, Migrator $m): void. They are applied
 * automatically on the first request after a deploy, or by bin/migrate.php.
 */
final class Migrator
{
    public Db $db;

    public function __construct(Db $db)
    {
        $this->db = $db;
    }

    public static function files(): array
    {
        $out = [];
        foreach (glob(dirname(__DIR__) . '/migrations/*.php') ?: [] as $f) {
            if (preg_match('/^(\d+)_/', basename($f), $m)) {
                $out[(int) $m[1]] = $f;
            }
        }
        ksort($out);
        return $out;
    }

    public static function current(Db $db): int
    {
        try {
            return (int) $db->val('SELECT MAX(version) FROM schema_migrations');
        } catch (\Throwable $e) {
            return 0;
        }
    }

    /** Versions already recorded as applied. */
    public static function applied(Db $db): array
    {
        try {
            return array_map('intval', array_column($db->all('SELECT version FROM schema_migrations'), 'version'));
        } catch (\Throwable $e) {
            return [];
        }
    }

    /** Applies pending migrations; returns the versions it applied. */
    public static function ensure(Db $db, ?int $upTo = null): array
    {
        $files = self::files();
        if ($upTo !== null) {
            $files = array_filter($files, static fn($v) => $v <= $upTo, ARRAY_FILTER_USE_KEY);
        }
        // Apply every migration that has not been recorded, not just ones numbered
        // above the newest. Two branches can each add a migration and be merged
        // in either order without one being skipped.
        $pending = array_diff_key($files, array_flip(self::applied($db)));
        if (!$pending) {
            return [];
        }
        $m = new Migrator($db);
        $db->pdo->exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INT NOT NULL PRIMARY KEY, applied_at VARCHAR(19) NOT NULL)');
        $applied = [];
        foreach ($pending as $version => $file) {
            $fn = require $file;
            $fn($db, $m);
            // Another request may have applied it at the same moment.
            if (!$db->val('SELECT version FROM schema_migrations WHERE version=?', [$version])) {
                $db->run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [$version, now_utc()]);
            }
            $applied[] = $version;
        }
        return $applied;
    }

    public function hasColumn(string $table, string $column): bool
    {
        if ($this->db->driver === 'sqlite') {
            foreach ($this->db->all("PRAGMA table_info($table)") as $c) {
                if ($c['name'] === $column) {
                    return true;
                }
            }
            return false;
        }
        return (bool) $this->db->all("SHOW COLUMNS FROM $table LIKE " . $this->db->pdo->quote($column));
    }

    /** CREATE TABLE with the few spots where MySQL and SQLite differ filled in. */
    public function table(string $name, string $body): void
    {
        $mysql = $this->db->driver === 'mysql';
        $body = str_replace('{{PK}}', $mysql ? 'INT NOT NULL AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT', $body);
        $opts = $mysql ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci' : '';
        $this->db->pdo->exec("CREATE TABLE IF NOT EXISTS $name ($body)$opts");
    }

    public function index(string $name, string $table, string $cols, bool $unique = false): void
    {
        $u = $unique ? 'UNIQUE ' : '';
        if ($this->db->driver === 'sqlite') {
            $this->db->pdo->exec("CREATE {$u}INDEX IF NOT EXISTS $name ON $table ($cols)");
            return;
        }
        try {
            $this->db->pdo->exec("CREATE {$u}INDEX $name ON $table ($cols)");
        } catch (\PDOException $e) {
            // 1061 = duplicate key name: the index is already there.
            if (($e->errorInfo[1] ?? 0) !== 1061) {
                throw $e;
            }
        }
    }
}
