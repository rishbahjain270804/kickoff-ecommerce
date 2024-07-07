const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');
const passport = require('./passport');
const mongoose = require('mongoose');
const User = require('./models/User');
const Order = require('./models/Order');
const axios = require('axios');
const CryptoJS = require('crypto-js');

mongoose.connect('mongodb://localhost/ecommerce', { useNewUrlParser: true, useUnifiedTopology: true });

app.use(bodyParser.json());
app.use(cors());
app.use(helmet());

app.use(passport.initialize());
app.use(passport.session());

const products = [
  { id: 1, name: 'Product 1', price: 10.99 },
  { id: 2, name: 'Product 2', price: 9.99 },
  { id: 3, name: 'Product 3', price: 12.99 }
];

app.get('/', (req, res) => {
  res.send('Welcome to our E-commerce API!');
});

// Get all products
app.get('/products', (req, res) => {
  res.json(products);
});

// Create a new product
app.post('/products/create', (req, res) => {
  const newProduct = req.body;
  products.push(newProduct);
  res.json(newProduct);
});

// Update an existing product
app.put('/products/:id/update', (req, res) => {
  const productId = req.params.id;
  const updatedProduct = req.body;
  const productIndex = products.findIndex((product) => product.id === parseInt(productId));
  if (productIndex!== -1) {
    products[productIndex] = updatedProduct;
    res.json(updatedProduct);
  } else {
    res.status(404).json({ error: 'Product not found' });
  }
});

// Delete a product
app.delete('/products/:id/delete', (req, res) => {
  const productId = req.params.id;
  const productIndex = products.findIndex((product) => product.id === parseInt(productId));
  if (productIndex!== -1) {
    products.splice(productIndex, 1);
    res.json({ message: 'Product deleted successfully' });
  } else {
    res.status(404).json({ error: 'Product not found' });
  }
});

const authMiddleware = (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  next();
};

app.post('/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) {
      return next(err);
    }
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    req.logIn(user, (err) => {
      if (err) {
        return next(err);
      }
      return res.json({ message: 'Logged in successfully' });
    });
  })(req, res, next);
});

app.post('/register', async (req, res) => {
  try {
    const user = new User(req.body);
    await user.save();
    res.json({ message: 'User created successfully' });
  } catch (err) {
    res.status(400).json({ message: 'Error creating user' });
  }
});

app.post('/orders', authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    const products = req.body.products;
    const total = req.body.total;
    const order = new Order({ user, products, total });
    await order.save();
    res.json({ message: 'Order created successfully' });
  } catch (err) {
    res.status(400).json({ message: 'Error creating order' });
  }
});

app.get('/orders', authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    const orders = await Order.find({ user: user._id });
    res.json(orders);
  } catch (err) {
    res.status(400).json({ message: 'Error retrieving orders' });
  }
});

app.get('/orders/:id', authMiddleware, async (req, res) => {
  try {
    const orderId = req.params.id;
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    res.json(order);
  } catch (err) {
    res.status(400).json({ message: 'Error retrieving order' });
  }
});

app.post('/orders/:id/pay', async (req, res) => {
  try {
    const orderId = req.params.id;
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    const paymentMethod = req.body.paymentMethod;
    const paymentToken = req.body.paymentToken;
    const amount = order.total * 100; // convert to paise

    // UPI Payment Request Configuration
    const data = {
      merchantId: "PGTESTPAYUAT",
      merchantTransactionId: generatedTranscId(),
      merchantUserId: 'MUID' + req.user._id,
      name: req.user.name,
      amount: amount,
      redirectUrl: `http://localhost:3001/api/v1/orders/status/${generatedTranscId()}`,
      redirectMode: "POST",
      mobileNumber: req.user.phone,
      paymentInstrument: {
        type: "PAY_PAGE",
      },
    };

    const payload = JSON.stringify(data);
    const payloadMain = Buffer.from(payload).toString("base64");
    const key = "099eb0cd-02cf-4e2a-8aca-3e6c6aff0399";
    const keyIndex = 1;
    const string = payloadMain + "/pg/v1/pay" + key;
    const sha256 = CryptoJS.SHA256(string).toString();
    const checksum = sha256 + "###" + keyIndex;

    const prod_URL = "https://api-preprod.phonepe.com/apis/pg-sandbox/pg/v1/pay";
    const requestData = {
      method: "POST",
      url: prod_URL,
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        "X-VERIFY": checksum,
      },
      data: {
        request: payloadMain,
      },
    };

    axios.request(requestData)
      .then(async function (response) {
        const phonePeTransactionId = response.data.transactionId;
        order.status = 'paid';
        await order.save();
        res.json({ message: 'Order paid successfully', phonePeTransactionId });
      })
      .catch(function (error) {
        console.error("Payment API Error:", error.message);
        res.status(500).json({ message: 'Payment Failed', error: error.message });
      });
  } catch (err) {
    res.status(400).json({ message: 'Error processing payment' });
  }
});

app.get('/orders/status/:transactionId', async (req, res) => {
  try {
    const transactionId = req.params.transactionId;
    const order = await Order.findOne({ transactionId });
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    res.json({ message: 'Order status updated successfully' });
  } catch (err) {
    res.status(400).json({ message: 'Error updating order status' });
  }
});

app.listen(3000, () => {
  console.log('Server started on port 3000');
});

function generatedTranscId() {
  return Math.floor(100000000 + Math.random() * 900000000);
}