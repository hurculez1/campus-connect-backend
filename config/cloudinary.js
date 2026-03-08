const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dcy491xs1',
  api_key: process.env.CLOUDINARY_API_KEY || '727353244934744',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'sBronDdU9Pg96Z5DgCRvIuCMlpM',
  secure: true
});

module.exports = cloudinary;