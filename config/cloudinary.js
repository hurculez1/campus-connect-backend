const cloudinary = require('cloudinary').v2;

const getEnv = (key, fallback) => {
  const val = process.env[key];
  if (!val || val.includes('your_api_key') || val.includes('your_cloud_')) return fallback;
  return val;
};

cloudinary.config({
  cloud_name: getEnv('CLOUDINARY_CLOUD_NAME', 'dcy491xs1'),
  api_key: getEnv('CLOUDINARY_API_KEY', '727353244934744'),
  api_secret: getEnv('CLOUDINARY_API_SECRET', 'sBronDdU9Pg96Z5DgCRvIuCMlpM'),
  secure: true
});

module.exports = cloudinary;