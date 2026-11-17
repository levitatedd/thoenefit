<?php
declare(strict_types=1);

use TF\Db;
use TF\Migrator;

// Accounts made with the invite code no longer wait for the admin to approve them.
// Anyone still waiting from before can sign in now, with the password they chose.
return static function (Db $db, Migrator $m): void {
    $db->run("UPDATE users SET status='active' WHERE status='pending'");
};
