-- Run this once against the neon_skies database (e.g. via phpMyAdmin) to
-- create the leaderboard table. Not executed automatically by anything.
--
-- One row per (name, difficulty) holding that name's personal best — keeps
-- the table bounded by distinct playtesters rather than games played, and
-- stops a single repeat player from occupying multiple leaderboard slots.

CREATE TABLE IF NOT EXISTS scores (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(10) NOT NULL,
    score INT UNSIGNED NOT NULL,
    wave INT UNSIGNED NOT NULL,
    difficulty ENUM('easy', 'normal', 'hard') NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_name_difficulty (name, difficulty),
    INDEX idx_difficulty_score (difficulty, score DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
