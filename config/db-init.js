const { pool } = require('./database');

const initDatabase = async () => {
  try {
    console.log('--- Table Verification Started ---');

    // Create match_requests table if not exists with correct data types (VARCHAR for UUIDs)
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS match_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        from_user_id VARCHAR(36) NOT NULL,
        to_user_id VARCHAR(36) NOT NULL,
        status ENUM('pending', 'accepted', 'rejected') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_from_user (from_user_id),
        INDEX idx_to_user (to_user_id),
        UNIQUE KEY unique_request (from_user_id, to_user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    
    // Ensure matches table exists (core requirement)
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS matches (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user1_id VARCHAR(36) NOT NULL,
        user2_id VARCHAR(36) NOT NULL,
        is_active TINYINT(1) DEFAULT 1,
        matched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        unmatched_at TIMESTAMP NULL,
        unmatched_by VARCHAR(36) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_match (user1_id, user2_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Ensure connection_messages table exists
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS connection_messages (
        id VARCHAR(36) PRIMARY KEY,
        connection_id VARCHAR(36) NOT NULL,
        sender_id VARCHAR(36) NOT NULL,
        message_type ENUM('text', 'image', 'video', 'system') NOT NULL,
        content TEXT,
        media_url VARCHAR(500),
        is_read TINYINT(1) DEFAULT 0,
        read_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_conn (connection_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Ensure messages table exists and allows NULL or 0 for match_id (for self-notes)
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        match_id INT DEFAULT NULL,
        sender_id VARCHAR(36) NOT NULL,
        message_type ENUM('text', 'image', 'video', 'icebreaker', 'system') DEFAULT 'text',
        content TEXT,
        media_url VARCHAR(500),
        encrypted_payload TEXT,
        is_read TINYINT(1) DEFAULT 0,
        read_at TIMESTAMP NULL,
        is_deleted TINYINT(1) DEFAULT 0,
        deleted_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_match_id (match_id),
        INDEX idx_sender_id (sender_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // In case match_id was NOT NULL, make it NULLable
    try {
      await pool.execute('ALTER TABLE messages MODIFY match_id INT NULL');
    } catch(e) {}
     // Ensure notifications table exists WITHOUT the FK constraint that causes errors
    // First try to drop the problematic FK if it exists, then recreate without it
    try {
      await pool.execute(`ALTER TABLE notifications DROP FOREIGN KEY notifications_ibfk_1`);
    } catch (e) { /* FK may not exist, that's fine */ }

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        type VARCHAR(50) NOT NULL,
        title VARCHAR(255),
        body TEXT,
        data JSON,
        is_read TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Auto-promote system admin on startup
    await pool.execute(`
      UPDATE users 
      SET is_admin = 1, is_super_admin = 1, subscription_tier = 'vip', is_active = 1
      WHERE LOWER(email) = 'hurculez11@gmail.com'
    `);
    
    // Ensure all existing users are active (just in case)
    await pool.execute('UPDATE users SET is_active = 1 WHERE is_active IS NULL');

    console.log('--- Table Verification Complete ✅ ---');
  } catch (err) {
    console.error('❌ Database Initialization Failed:', err.message);
  }
};

module.exports = { initDatabase };
