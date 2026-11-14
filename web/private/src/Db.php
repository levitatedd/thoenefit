<?php
declare(strict_types=1);

namespace TF;

use PDO;

/** Thin PDO wrapper. All SQL in the app is written to run on both MySQL and SQLite. */
final class Db
{
    public PDO $pdo;
    public string $driver;

    public function __construct(array $c)
    {
        $this->driver = $c['driver'] ?? 'mysql';
        $opts = [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ];
        if ($this->driver === 'sqlite') {
            $this->pdo = new PDO('sqlite:' . $c['path'], null, null, $opts);
            $this->pdo->exec('PRAGMA busy_timeout = 5000');
            if ($c['path'] !== ':memory:') {
                $this->pdo->exec('PRAGMA journal_mode = WAL');
            }
        } elseif ($this->driver === 'mysql') {
            $dsn = 'mysql:host=' . $c['host'] . ';dbname=' . $c['name'] . ';charset=utf8mb4';
            if (!empty($c['port'])) {
                $dsn .= ';port=' . (int) $c['port'];
            }
            $opts[PDO::ATTR_EMULATE_PREPARES] = false;
            $this->pdo = new PDO($dsn, $c['user'], $c['password'], $opts);
            $this->pdo->exec("SET time_zone = '+00:00'");
        } else {
            throw new \RuntimeException('Unsupported database driver: ' . $this->driver);
        }
    }

    public function run(string $sql, array $params = []): \PDOStatement
    {
        $st = $this->pdo->prepare($sql);
        $st->execute(array_values($params));
        return $st;
    }

    public function all(string $sql, array $params = []): array
    {
        return $this->run($sql, $params)->fetchAll();
    }

    public function one(string $sql, array $params = []): ?array
    {
        $row = $this->run($sql, $params)->fetch();
        return $row === false ? null : $row;
    }

    public function val(string $sql, array $params = [])
    {
        $row = $this->run($sql, $params)->fetch(PDO::FETCH_NUM);
        return $row === false ? null : $row[0];
    }

    public function insert(string $table, array $data): int
    {
        $cols = array_keys($data);
        $sql = 'INSERT INTO ' . $table . ' (' . implode(',', $cols) . ') VALUES (' . implode(',', array_fill(0, count($cols), '?')) . ')';
        $this->run($sql, array_values($data));
        return (int) $this->pdo->lastInsertId();
    }

    public function update(string $table, array $data, string $where, array $params): void
    {
        $set = implode(',', array_map(static fn($c) => "$c=?", array_keys($data)));
        $this->run("UPDATE $table SET $set WHERE $where", array_merge(array_values($data), $params));
    }

    /** Runs $fn inside a transaction and returns its result. */
    public function tx(callable $fn)
    {
        $this->pdo->beginTransaction();
        try {
            $out = $fn($this);
            $this->pdo->commit();
            return $out;
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }
    }

    /** "?,?,?" for an IN (...) list. */
    public static function marks(array $items): string
    {
        return implode(',', array_fill(0, count($items), '?'));
    }
}
