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

    // Optional. Set your web host as the Authorization Callback Domain in Strava.
    'strava' => [
        'client_id' => '',
        'client_secret' => '',
        'callback_url' => 'https://fit.example.com/api.php?a=strava_callback',
    ],

    // Optional. Lets people send feedback from Settings; each one becomes a
    // public issue in this repository. Without a token the option is hidden.
    // Use a fine-grained personal access token limited to this one repository
    // with "Issues: Read and write" and no other permissions.
    'github' => [
        'token' => '',
        'repo' => 'levitatedd/thoenefit',
    ],
];
