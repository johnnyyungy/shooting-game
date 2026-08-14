<?php
header('Content-Type: application/json');
require __DIR__ . '/config.php';

$validDifficulties = ['easy', 'normal', 'hard'];
$difficulty = isset($_GET['difficulty']) ? strtolower(trim((string)$_GET['difficulty'])) : 'normal';
if (!in_array($difficulty, $validDifficulties, true)) {
    $difficulty = 'normal';
}

$stmt = $pdo->prepare(
    'SELECT name, score, wave, created_at FROM scores
     WHERE difficulty = :difficulty
     ORDER BY score DESC, wave DESC
     LIMIT 50'
);
$stmt->execute([':difficulty' => $difficulty]);
$rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

echo json_encode(['difficulty' => $difficulty, 'scores' => $rows]);
