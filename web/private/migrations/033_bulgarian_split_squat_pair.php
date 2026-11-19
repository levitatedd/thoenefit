<?php
declare(strict_types=1);

use TF\Db;
use TF\Migrator;

// Feedback #254: the Bulgarian Split Squat is done with a dumbbell in each hand, so it
// needs a dumbbell pair, not a single dumbbell. Only this exercise changes, and only
// where it still has the original values, so an admin's own edits are kept. (An earlier
// version re-synced the whole library, which would have overwritten edited cues; #265's
// migration 034 then turns this cue into its clearer wording.)
return static function (Db $db, Migrator $m): void {
    $oldCue = 'Rest your back foot on the bench and hop your front foot forward. Drop your back knee straight down, lean slightly forward, and stand through your front heel. Count reps per side.';
    foreach ($db->all("SELECT id, equipment, cues FROM exercises WHERE slug='bulgarian-split-squat' AND user_id IS NULL") as $row) {
        if (json_decode((string) $row['equipment'], true) === ['single_dumbbell', 'bench']) {
            $db->run('UPDATE exercises SET equipment=? WHERE id=?', [json_encode(['dumbbells', 'bench']), $row['id']]);
        }
        if ($row['cues'] === $oldCue) {
            $db->run('UPDATE exercises SET cues=? WHERE id=?', ['Hold a dumbbell in each hand. ' . $oldCue, $row['id']]);
        }
    }
};
