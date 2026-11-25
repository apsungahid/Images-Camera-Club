const fs = require('node:fs');
const path = require('node:path');

const heroFile = path.join(__dirname, '..', 'public', 'images', 'hero.jpg');

// Club details shown across the site. Edit here, not in the templates.
module.exports = {
  name: 'Images Camera Club',
  fullName: 'Images Camera Club of Cebu',
  place: 'Cebu, Philippines',
  tagline: 'Photographers of Cebu, seeing the island one frame at a time.',
  url: 'https://www.imagescameraclub.com',
  email: null, // e.g. 'info@imagescameraclub.com' once email routing is set up
  // Drop a wide photo at public/images/hero.jpg (about 2400px wide) to use it on the homepage.
  heroImage: fs.existsSync(heroFile) ? '/images/hero.jpg' : null,
  heroCredit: null, // e.g. 'Photograph by Juan dela Cruz'
  social: {
    facebook: null,
    instagram: null,
  },
};
