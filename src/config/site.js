// Public site identity used for canonical URLs and Open Graph / Twitter meta tags.
const SITE_URL = String(process.env.APP_PUBLIC_URL || 'https://qualitickzm.com').replace(/\/+$/, '');

// Social crawlers don't render SVG, so the default share image must be a raster file.
const DEFAULT_OG_IMAGE_PATH = '/images/icons/logo-invoice.png';

module.exports = {
    SITE_URL,
    DEFAULT_OG_IMAGE_PATH,
    DEFAULT_OG_IMAGE: `${SITE_URL}${DEFAULT_OG_IMAGE_PATH}`
};
