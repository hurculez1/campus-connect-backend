-- Ensure universities table exists with correct column names
CREATE TABLE IF NOT EXISTS universities (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    student_email_domain VARCHAR(255),
    logo_url VARCHAR(255),
    is_verified BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Populate universities with verified status
INSERT INTO universities (name, student_email_domain, is_verified) VALUES
('Makerere University', 'mak.ac.ug', TRUE),
('Kyambogo University', 'kyu.ac.ug', TRUE),
('Uganda Christian University', 'ucu.ac.ug', TRUE),
('Mbarara University', 'must.ac.ug', TRUE),
('Ndejje University', 'ndejje.ac.ug', TRUE),
('Kampala International University', 'kiu.ac.ug', TRUE),
('Busitema University', 'busitema.ac.ug', TRUE),
('Gulu University', 'gu.ac.ug', TRUE),
('Muni University', 'muni.ac.ug', TRUE),
('Victoria University', 'vu.ac.ug', TRUE),
('MUBS', 'mubs.ac.ug', TRUE),
('St. Lawrence University', 'slu.ac.ug', TRUE),
('Nkumba University', 'nkumbauniversity.ac.ug', TRUE),
('Cavendish University', 'cavendish.ac.ug', TRUE)
ON DUPLICATE KEY UPDATE is_verified = TRUE;
