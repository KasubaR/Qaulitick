# Shop.ejs File Connections

This document lists all files connected to `views/shop.ejs`.

## 📄 Template File
- **Main Template**: `views/shop.ejs`

---

## 🔗 Included Partials (EJS Templates)

### Header & Footer
- `views/partials/header.ejs` - Page header with meta tags, CSS links
- `views/partials/footer.ejs` - Footer with JavaScript links
- `views/partials/navbar.ejs` - Navigation bar (included in header)

---

## 🎨 CSS Files

### Global Stylesheets (Always Loaded)
- `/css/main.css` - Main global stylesheet
- `/css/responsive.css` - Responsive design styles

### Page-Specific Stylesheet
- `/css/shop.css` - Shop page specific styles (loaded when `page === 'shop'`)

---

## 📜 JavaScript Files

### Global Scripts (Always Loaded)
- `/js/error-handler.js` - Global error handling
- `/js/main.js` - Global JavaScript functionality

### Page-Specific Script
- `/js/shop.js` - Shop page functionality (loaded when `page === 'shop'`)

---

## 🛣️ Backend Routes & Controllers

### Route Definition
- **File**: `src/app.js`
- **Route**: `GET /shop`
- **Handler**: `productController.renderShop`

### Controller
- **File**: `src/controllers/product.controller.js`
- **Function**: `exports.renderShop`
- **Purpose**: Renders shop page with products from database

---

## 🗄️ Database & Services

### Service Layer
- **File**: `src/services/product.service.js`
- **Method**: `getAllProducts({ status: 'active' })`
- **Purpose**: Fetches active products from MongoDB

### Database Model
- **File**: `src/models/Product.model.js`
- **Collection**: `products` in MongoDB
- **Purpose**: Product schema definition

### Database Config
- **File**: `src/config/database.js`
- **Purpose**: MongoDB connection configuration

---

## 🌐 API Endpoints Used

### Products API
- **Endpoint**: `GET /api/products`
- **Used by**: `shop.js` for filtering, sorting, and pagination
- **Controller**: `src/controllers/product.controller.js` → `exports.getProductsAPI`

### Product Search API
- **Endpoint**: `GET /api/products/search`
- **Used by**: `shop.js` for search functionality
- **Controller**: `src/controllers/product.controller.js` → `exports.searchProducts`

---

## 🔧 Utility Files

### Price Calculations
- **File**: `src/utils/price.utils.js`
- **Functions**: 
  - `calculateFinalPrice()` - Calculates final price after discount
  - `calculateSavings()` - Calculates savings amount
- **Used by**: Product controller when rendering shop page

### Validators
- **File**: `src/utils/validators.js`
- **Functions**: Query parameter validation
- **Used by**: Product controller for API requests

### Error Middleware
- **File**: `src/middlewares/error.middleware.js`
- **Function**: `handleNoProducts()` - Handles empty product list
- **Used by**: Product controller when no products found

---

## 📦 External Dependencies

### CDN Resources
- **Google Fonts**: Poppins font family
- **Font Awesome**: Icons (v6.4.0)
- **URL**: `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css`

---

## 🔄 Data Flow

```
User Request (/shop)
    ↓
src/app.js (Route Handler)
    ↓
src/controllers/product.controller.js (renderShop)
    ↓
src/services/product.service.js (getAllProducts)
    ↓
src/models/Product.model.js (Mongoose Model)
    ↓
MongoDB Database
    ↓
Products Data + Price Calculations
    ↓
views/shop.ejs (Rendered with data)
    ↓
Browser (HTML + CSS + JS)
    ↓
public/js/shop.js (Client-side filtering/sorting)
    ↓
GET /api/products (AJAX requests)
```

---

## 📋 Data Passed to Template

The following data is passed to `shop.ejs`:

```javascript
{
    title: 'Shop Luxury Watches | Qualitick Collections',
    page: 'shop',
    products: productsWithPrices, // Array of product objects
    description: 'Shop premium triple-A luxury watches...',
    keywords: 'luxury watches, AAA replica watches...',
    canonicalUrl: 'https://qualitick-collections.com/shop',
    url: '/shop',
    ogType: 'website'
}
```

Each product object includes:
- `_id`, `model`, `brand`, `sku`
- `price`, `originalPrice`, `discount`, `finalPrice`
- `stock`, `status`, `images[]`
- `rating`, `reviews[]`
- `gender`, `strapOptions[]`
- And other product fields

---

## 🎯 Key Features

### Client-Side (shop.js)
- Product filtering (brand, gender, price, strap, rating)
- Search functionality
- Sorting (price, popularity, rating, latest)
- Pagination
- Grid/List view toggle
- Active filters display
- URL parameter synchronization

### Server-Side (Controller)
- Fetches active products from database
- Calculates prices with discounts
- Handles empty product scenarios
- SEO optimization
- Structured data (Schema.org)

---

## 📝 Summary

**Total Files Connected**: ~15+ files

**Categories**:
- **Templates**: 3 files (shop.ejs, header.ejs, footer.ejs, navbar.ejs)
- **CSS**: 3 files (main.css, responsive.css, shop.css)
- **JavaScript**: 3 files (error-handler.js, main.js, shop.js)
- **Backend**: 5+ files (app.js, controllers, services, models, utils, middlewares)
- **External**: 2 CDN resources (Google Fonts, Font Awesome)

