<?php
header('Content-Type: application/json');
require __DIR__ . '/config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);

$name = isset($input['name']) ? trim((string)$input['name']) : '';
$score = isset($input['score']) ? (int)$input['score'] : null;
$wave = isset($input['wave']) ? (int)$input['wave'] : null;
$difficulty = isset($input['difficulty']) ? strtolower(trim((string)$input['difficulty'])) : '';

$validDifficulties = ['easy', 'normal', 'hard'];

// Basic sanity checks — enough to reject obviously-bogus submissions at a
// playtester scale, not full server-authoritative anti-cheat.
if (
    $name === '' ||
    $score === null || $score < 0 || $score > 10000000 ||
    $wave === null || $wave < 1 || $wave > 2000 ||
    !in_array($difficulty, $validDifficulties, true)
) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid submission']);
    exit;
}

// Freeform playtester name: strip to a safe character set and cap length.
$name = preg_replace('/[^A-Za-z0-9 _-]/', '', $name);
$name = mb_substr(trim($name), 0, 10);
if ($name === '') {
    $name = 'PLAYER';
}

// One row per name+difficulty, holding only that name's personal best. If
// this name already has a row, only overwrite it when the new run is
// actually better — a worse run just gets ignored, not recorded.
$existing = $pdo->prepare(
    'SELECT score, wave FROM scores WHERE name = :name AND difficulty = :difficulty'
);
$existing->execute([':name' => $name, ':difficulty' => $difficulty]);
$row = $existing->fetch(PDO::FETCH_ASSOC);

$isNewBest = false;
if ($row === false) {
    $stmt = $pdo->prepare(
        'INSERT INTO scores (name, score, wave, difficulty) VALUES (:name, :score, :wave, :difficulty)'
    );
    $stmt->execute([':name' => $name, ':score' => $score, ':wave' => $wave, ':difficulty' => $difficulty]);
    $isNewBest = true;
    $effectiveScore = $score;
    $effectiveWave = $wave;
} elseif ($score > (int)$row['score']) {
    $stmt = $pdo->prepare(
        'UPDATE scores SET score = :score, wave = :wave, created_at = CURRENT_TIMESTAMP
         WHERE name = :name AND difficulty = :difficulty'
    );
    $stmt->execute([':name' => $name, ':score' => $score, ':wave' => $wave, ':difficulty' => $difficulty]);
    $isNewBest = true;
    $effectiveScore = $score;
    $effectiveWave = $wave;
} else {
    $effectiveScore = (int)$row['score'];
    $effectiveWave = (int)$row['wave'];
}

// Rank among this name's effective (stored) best, using the same
// score-desc/wave-desc ordering the leaderboard itself displays with.
$rankStmt = $pdo->prepare(
    'SELECT COUNT(*) AS higher FROM scores
     WHERE difficulty = :difficulty
       AND (score > :score OR (score = :score AND wave > :wave))'
);
$rankStmt->execute([':difficulty' => $difficulty, ':score' => $effectiveScore, ':wave' => $effectiveWave]);
$rank = (int)$rankStmt->fetch(PDO::FETCH_ASSOC)['higher'] + 1;

echo json_encode([
    'success' => true,
    'name' => $name,
    'score' => $effectiveScore,
    'wave' => $effectiveWave,
    'isNewBest' => $isNewBest,
    'rank' => $rank,
    'madeTop50' => $rank <= 50,
]);
