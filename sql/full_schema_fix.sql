-- ─── Campus Connect Uganda — Full MySQL Schema Fix ────────────────────────────
-- Run this entire script in phpMyAdmin → quickerc_campus_db → SQL tab

-- Add missing columns to users table (safe, won't error if column already exists)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_banned TINYINT(1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ban_reason VARCHAR(500) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_active TINYINT(1) DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_admin TINYINT(1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_super_admin TINYINT(1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS verification_status VARCHAR(50) DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS subscription_tier VARCHAR(20) DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS pronouns VARCHAR(50) DEFAULT '',
  ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS course VARCHAR(200) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS year_of_study INT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS interests JSON DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS photos JSON DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS profile_photo_url VARCHAR(500) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS student_email VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS location_lat DECIMAL(10,8) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS location_lng DECIMAL(11,8) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS city VARCHAR(100) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS show_me TINYINT(1) DEFAULT 1,
  ADD COLUMN IF NOT EXISTS preferred_gender JSON DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS preferred_age_min INT DEFAULT 18,
  ADD COLUMN IF NOT EXISTS preferred_age_max INT DEFAULT 35,
  ADD COLUMN IF NOT EXISTS preferred_distance_km INT DEFAULT 50,
  ADD COLUMN IF NOT EXISTS language_preference VARCHAR(20) DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS gender VARCHAR(30) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS date_of_birth DATE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS university VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS daily_swipes_used INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_swipes_reset_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_checked_likes TIMESTAMP DEFAULT '1970-01-01 00:00:01',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- ─── Grant admin access to your account ───────────────────────────────────────
-- IMPORTANT: Replace YOUR_EMAIL_HERE with your actual email address before running!
UPDATE users SET is_admin = 1, is_super_admin = 1 WHERE email = 'hurculez11@gmail.com';

-- Create user_settings table if missing
CREATE TABLE IF NOT EXISTS user_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    email_notifications TINYINT(1) DEFAULT 1,
    push_notifications TINYINT(1) DEFAULT 1,
    match_notifications TINYINT(1) DEFAULT 1,
    message_notifications TINYINT(1) DEFAULT 1,
    show_online_status TINYINT(1) DEFAULT 1,
    show_last_active TINYINT(1) DEFAULT 1,
    profile_visibility VARCHAR(20) DEFAULT 'everyone',
    distance_unit VARCHAR(10) DEFAULT 'km',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Create posts table if missing (for Pulse feature)
CREATE TABLE IF NOT EXISTS posts (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) DEFAULT NULL,
    content TEXT NOT NULL,
    campus VARCHAR(200) DEFAULT NULL,
    is_anonymous TINYINT(1) DEFAULT 0,
    type VARCHAR(20) DEFAULT 'general',
    likes_count INT DEFAULT 0,
    comments_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Create university_verifications table if missing
CREATE TABLE IF NOT EXISTS university_verifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    university_name VARCHAR(255),
    student_email VARCHAR(255),
    student_email_token VARCHAR(100),
    id_card_url VARCHAR(500),
    status VARCHAR(30) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Create universities table if missing
CREATE TABLE IF NOT EXISTS universities (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    student_email_domain VARCHAR(255),
    logo_url VARCHAR(255),
    is_verified TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Insert sample universities
INSERT INTO universities (name, student_email_domain, is_verified) VALUES
('Makerere University', 'mak.ac.ug', 1),
('Kyambogo University', 'kyu.ac.ug', 1),
('Uganda Christian University', 'ucu.ac.ug', 1),
('Mbarara University', 'must.ac.ug', 1),
('Kampala International University', 'kiu.ac.ug', 1),
('Ndejje University', 'ndejje.ac.ug', 1),
('Busitema University', 'busitema.ac.ug', 1),
('Gulu University', 'gu.ac.ug', 1),
('MUBS', 'mubs.ac.ug', 1),
('Nkumba University', 'nkumbauniversity.ac.ug', 1)
ON DUPLICATE KEY UPDATE is_verified = 1;

-- Create connections table for unmatched user chat
CREATE TABLE IF NOT EXISTS connections (
    id VARCHAR(36) PRIMARY KEY,
    user1_id VARCHAR(36) NOT NULL,
    user2_id VARCHAR(36) NOT NULL,
    initiated_by VARCHAR(36) NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user1_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (user2_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_connection (user1_id, user2_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Create connection_messages table
CREATE TABLE IF NOT EXISTS connection_messages (
    id VARCHAR(36) PRIMARY KEY,
    connection_id VARCHAR(36) NOT NULL,
    sender_id VARCHAR(36) NOT NULL,
    content TEXT NOT NULL,
    message_type VARCHAR(20) DEFAULT 'text',
    is_read TINYINT(1) DEFAULT 0,
    read_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
