const express = require('express');
const mssql = require('mssql');
const app = express();
const port = 3000;
const cors = require('cors');
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(cors({
  origin: 'http://127.0.0.1:5500', // Тот адрес, откуда ты открываешь HTML-файл
  credentials: true               // ВАЖНО: разрешить отправку куки
}));

const session = require('express-session');
app.use(session({
  secret: 'mclaren_secret_key',
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: false, // true — только по HTTPS
    sameSite: 'lax' // обязательно указать, чтобы работало на кросс-домене
  }
}));
// Настройка конфигурации для подключения к БД с использованием Windows Authentication
const sqlConfig = {
  user: '090T',
  password: '090T',
  server: 'DESKTOP-UBFNKMT',
  database: 'McLaren_Store',
  options: {
    encrypt: true,
    trustServerCertificate: true,
    integratedSecurity: false
  }
};

// Подключение к базе данных
mssql.connect(sqlConfig)
  .then(pool => {
    console.log('✅ Подключение к БД успешно');
    app.locals.db = pool;

    // Запуск сервера после успешного подключения
    app.listen(port, () => {
      console.log(`🚀 Сервер запущен на http://localhost:${port}`);
    });

  })
  .catch(err => {
    console.error('❌ Ошибка подключения к базе данных:', err);
  });

// API маршрут для получения всех доступных машин
app.get('/api/cars', async (req, res) => {
  try {
    const result = await app.locals.db
      .request()
      .query('SELECT * FROM Cars WHERE Available = 1');

    const cars = result.recordset.map(car => ({
      CarID: car.CarID,
      Model: car.Model,
      Year: car.Year,
      Color: car.Color,
      Price: car.Price,
      EngineType: car.EngineType,
      Transmission: car.Transmission,
      Available: car.Available,
      Image: car.Image ? Buffer.from(car.Image).toString('base64') : null
    }));

    res.json(cars);
  } catch (error) {
    console.error('❌ Ошибка при получении машин:', error);
    res.status(500).send('Ошибка сервера при получении данных из таблицы Cars');
  }
});
app.get('/api/getProfile', async (req, res) => {
  try {
      const pool = app.locals.db;

      // Используем текущего пользователя для получения его данных из БД
      const userId = req.session.user?.id;  // Используем ID из сессии

      if (!userId) {
          return res.json({ success: false, message: 'Пользователь не авторизован' });
      }

      let request = pool.request();
      request.input('id', mssql.Int, userId);

      const result = await request.query('SELECT * FROM Customers WHERE CustomerID = @id');

      if (result.recordset.length > 0) {
          const userData = result.recordset[0];
          return res.json({
              success: true,
              user: {
                  firstName: userData.FirstName,
                  lastName: userData.LastName,
                  username: userData.UserName,
                  email: userData.Email,
                  password: userData.Password
                  // Можно добавить дополнительные данные, если нужно
              }
          });
      } else {
          return res.json({ success: false, message: 'Пользователь не найден' });
      }
  } catch (err) {
      console.error('❌ Ошибка при получении данных профиля:', err);
      res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});
app.post('/api/updateProfile', async (req, res) => {
  const { firstName, lastName, username, email, password } = req.body;

  try {
      const pool = app.locals.db;

      // Используем текущего пользователя для обновления его данных
      const userId = req.session.user?.id;  // Получаем id текущего пользователя

      if (!userId) {
          return res.json({ success: false, message: 'Пользователь не авторизован' });
      }

      let query = `UPDATE CustomerS SET 
                      FirstName = @firstName,
                      LastName = @lastName,
                      UserName = @username,
                      Email = @email`;

      // Если пользователь меняет пароль, добавляем условие для обновления пароля
      if (password) {
          query += `, Password = @password`;
      }

      query += ` WHERE CustomerID = @id`;

      // Отправляем запрос на обновление данных в базе данных
      let request = pool.request();
      request.input('id', mssql.Int, userId);
      request.input('firstName', mssql.VarChar, firstName);
      request.input('lastName', mssql.VarChar, lastName);
      request.input('username', mssql.VarChar, username);
      request.input('email', mssql.VarChar, email);

      if (password) {
          request.input('password', mssql.VarChar, password);
      }

      await request.query(query);

      res.json({ success: true, message: 'Профиль обновлен' });
  } catch (err) {
      console.error('❌ Ошибка при обновлении данных профиля:', err);
      res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});
// API для авторизации
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const pool = app.locals.db;

    // Поиск в Employees
    let request = pool.request();
    request.input('username', mssql.VarChar, username);
    request.input('password', mssql.VarChar, password);

    const employee = await request.query('SELECT * FROM Employees WHERE UserName = @username AND Password = @password');

    if (employee.recordset.length > 0) {
      const emp = employee.recordset[0];

      // Сохраняем в сессию
      req.session.user = {
        id: emp.EmployeeID,
        firstName: emp.FirstName,
        lastName: emp.LastName,
        username: emp.UserName,
        email: emp.Email,
        role: emp.RoleID === 1 ? 'admin' : 'user',
        password: emp.Password
      };

      return res.json({ success: true, role: req.session.user.role, user: req.session.user });
    }

    // Поиск в Customers
    request = pool.request();
    request.input('username', mssql.VarChar, username);
    request.input('password', mssql.VarChar, password);

    const customer = await request.query('SELECT * FROM Customers WHERE UserName = @username AND Password = @password');

    if (customer.recordset.length > 0) {
      const cust = customer.recordset[0];

      req.session.user = {
        id: cust.CustomerID,
        firstName: cust.FirstName,
        lastName: cust.LastName,
        username: cust.UserName,
        email: cust.Email,
        role: 'user',
        password: cust.Password
      };

      return res.json({ success: true, role: 'user', user: req.session.user });
    }

    return res.json({ success: false, message: "Неверные данные" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Ошибка сервера" });
  }
});
app.get('/api/session', (req, res) => {
  if (req.session.user) {
    res.json({ loggedIn: true, user: req.session.user });
  } else {
    res.json({ loggedIn: false });
  }
});
app.post('/api/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ success: false });
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});
