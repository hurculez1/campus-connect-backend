-- ─── Campus Connect Uganda — Chat & Match Tables Fix ────────────────────────────
-- Run this script to ensure core interaction tables exist in MySQL

-- Create swipes table
CREATE TABLE IF NOT EXISTS swipes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    swiper_id VARCHAR(36) NOT NULL,
    swiped_id VARCHAR(36) NOT NULL,
    direction ENUM('like', 'pass', 'super_like') NOT NULL,
    is_match TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (swiper_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (swiped_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_swipe (swiper_id, swiped_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Create matches table
CREATE TABLE IF NOT EXISTS matches (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user1_id VARCHAR(36) NOT NULL,
    user2_id VARCHAR(36) NOT NULL,
    swipe1_id INT DEFAULT NULL,
    swipe2_id INT DEFAULT NULL,
    is_active TINYINT(1) DEFAULT 1,
    matched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    unmatched_at TIMESTAMP NULL,
    unmatched_by VARCHAR(36) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user1_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (user2_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (swipe1_id) REFERENCES swipes(id) ON DELETE SET NULL,
    FOREIGN KEY (swipe2_id) REFERENCES swipes(id) ON DELETE SET NULL,
    UNIQUE KEY unique_match (user1_id, user2_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Create messages table
CREATE TABLE IF NOT EXISTS messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    match_id INT NOT NULL,
    sender_id VARCHAR(36) NOT NULL,
    message_type ENUM('text', 'image', 'video', 'icebreaker') DEFAULT 'text',
    content TEXT,
    media_url VARCHAR(500),
    encrypted_payload TEXT,
    is_read TINYINT(1) DEFAULT 0,
    read_at TIMESTAMP NULL,
    is_deleted TINYINT(1) DEFAULT 0,
    deleted_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255),
    body TEXT,
    data JSON,
    is_read TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Create blocks table
CREATE TABLE IF NOT EXISTS blocks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    blocker_id VARCHAR(36) NOT NULL,
    blocked_id VARCHAR(36) NOT NULL,
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_block (blocker_id, blocked_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Create match_requests table (for Match Now feature)
CREATE TABLE IF NOT EXISTS match_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    from_user_id INT NOT NULL,
    to_user_id INT NOT NULL,
    status ENUM('pending', 'accepted', 'rejected') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_from_user (from_user_id),
    INDEX idx_to_user (to_user_id),
    UNIQUE KEY unique_request (from_user_id, to_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
