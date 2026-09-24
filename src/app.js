require('dotenv').config();

const http = require('http');
const path = require('path');
const express = require('express');
const morgan = require('morgan');
const flash = require('connect-flash');
const { engine } = require('express-handlebars');
const { Server } = require('socket.io');

const connectDB = require('./config/db');
const createSession = require('./config/session');
const passport = require('./config/passport');
const locals = require('./middleware/locals');
const seedItems = require('./seed/items');
const attachSocket = require('./game/socket');
const helpers = require('./views/helpers');

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/teatrix';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Com um segredo conhecido (o padrão ou o do .env.example), qualquer um forjaria o cookie de login.
const weakSecret = (s) => !s || s === 'troque-este-segredo' || s.length < 16;
if (IS_PRODUCTION && weakSecret(process.env.SESSION_SECRET)) {
  console.error('Defina um SESSION_SECRET forte (16+ caracteres) no .env antes de rodar em produção.');
  process.exit(1);
}
if (!process.env.SESSION_SECRET) console.warn('Aviso: SESSION_SECRET não definido; usando um segredo de desenvolvimento.');
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-troque-em-producao';

const ROOT = path.join(__dirname, '..');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const sessionMiddleware = createSession({ mongoUri: MONGO_URI, secret: SESSION_SECRET });

// Views
app.engine('hbs', engine({ extname: '.hbs', defaultLayout: 'main', helpers }));
app.set('view engine', 'hbs');
app.set('views', path.join(ROOT, 'views'));
// Túneis (ngrok, cloudflared) rodam na mesma máquina: confia no X-Forwarded-Proto deles,
// para req.protocol ser "https" e o QR code da sala apontar para o link certo.
app.set('trust proxy', 'loopback');

// Middlewares
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));
app.use(express.static(path.join(ROOT, 'public')));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(sessionMiddleware);
app.use(passport.session());
app.use(flash());
app.use(locals);

// Rotas
app.use(require('./routes/auth'));
app.use(require('./routes/lobby'));
app.use(require('./routes/shop'));
app.use(require('./routes/history'));
app.use(require('./routes/profile'));
app.use(require('./routes/media'));
app.use(require('./routes/about'));

app.use((req, res) => res.status(404).render('error', { title: 'Não encontrado', message: 'Página não encontrada.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Erro', message: 'Algo deu errado. Tente novamente.' });
});

attachSocket(io, sessionMiddleware, passport);

async function main() {
  await connectDB(MONGO_URI);
  await seedItems();
  server.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Falha ao iniciar:', err);
  process.exit(1);
});
