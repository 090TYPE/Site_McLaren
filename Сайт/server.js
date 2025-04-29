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
  try {
      const { CustomerID, UserName, Password, FirstName, LastName, PhoneNumber, Email, Address } = req.body;
      console.log("Обновляем данные для клиента с ID:", CustomerID);
      console.log('Received update data:', req.body);

      // Проверяем, что все обязательные поля присутствуют, в том числе пароль
      if (!CustomerID || !FirstName || !LastName || !UserName || !PhoneNumber || !Email || !Address || !Password) {
          return res.status(400).json({ success: false, message: 'Все поля должны быть заполнены, включая пароль' });
      }

      const pool = app.locals.db; // Получаем подключение к БД из app.locals

      // Параметризированный запрос для обновления данных пользователя
      const query = `
          UPDATE dbo.Customers
          SET UserName = @UserName, FirstName = @FirstName, LastName = @LastName, PhoneNumber = @PhoneNumber, Email = @Email, Address = @Address, Password = @Password
          WHERE CustomerID = @CustomerID
      `;
      
      const request = pool.request();
      request.input('UserName', mssql.VarChar, UserName);
      request.input('FirstName', mssql.VarChar, FirstName);
      request.input('LastName', mssql.VarChar, LastName);
      request.input('PhoneNumber', mssql.VarChar, PhoneNumber);
      request.input('Email', mssql.VarChar, Email);
      request.input('Address', mssql.VarChar, Address);
      request.input('Password', mssql.VarChar, Password);
      request.input('CustomerID', mssql.Int, CustomerID);

      // Выполняем запрос к базе данных
      await request.query(query);

      res.json({ success: true });
  } catch (error) {
      console.error('Error updating profile:', error);
      res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});



// API для авторизации
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  
  try {
    const pool = app.locals.db;
    const request = pool.request()
      .input('username', mssql.VarChar, username)
      .input('password', mssql.VarChar, password);

    // Проверка пользователя среди клиентов
    const customerQuery = `SELECT * FROM Customers WHERE UserName = @username AND Password = @password`;
    const customerResult = await request.query(customerQuery);

    // Если не найден среди клиентов, проверяем среди сотрудников
    if (customerResult.recordset.length === 0) {
      const employeeQuery = `SELECT * FROM Employees WHERE UserName = @username AND Password = @password`;
      const employeeResult = await request.query(employeeQuery);

      if (employeeResult.recordset.length > 0) {
        // Если сотрудник найден, перенаправляем на админ панель
        const employee = employeeResult.recordset[0];
        req.session.user = {
          id: employee.EmployeeID,
          username: employee.UserName,
          role: 'admin', // Роль для сотрудников
        };
        return res.json({
          success: true,
          user: employee,
          redirectToAdminPanel: true,  // Уведомляем фронт, что нужно перенаправить
        });
      } else {
        return res.json({ success: false, message: 'Неверные данные пользователя или пароля' });
      }
    } else {
      const customer = customerResult.recordset[0];
      req.session.user = {
        id: customer.CustomerID,
        username: customer.UserName,
        role: 'user',  // Роль для клиентов
      };
      return res.json({
        success: true,
        user: customer,
        redirectToAdminPanel: false,  // Уведомляем фронт, что можно отобразить обычный профиль
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
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
