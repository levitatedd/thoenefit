<?php
// ThoeneFit server settings.
//
// Copy this file to the folder ABOVE your site's web folder and name it
// thoenefit-config.php. On DreamHost that is your user's home folder:
//
//     /home/USERNAME/thoenefit-config.php      <- this file (never served)
//     /home/USERNAME/fit.example.com/          <- web folder (index.html, api.php, ...)
//
// Then make it readable only by you:  chmod 600 ~/thoenefit-config.php
//
// Never commit the filled-in copy to GitHub.

return [
    'db' => [
        'driver' => 'mysql',
        'host' => 'mysql.example.com',   // the hostname DreamHost shows for your database
        'name' => 'thoenefit',           // database name
        'user' => 'thoenefit_user',      // database user
        'password' => 'change-me',
    ],

    // How long a sign-in lasts without use, in days.
    'session_days' => 60,
];
