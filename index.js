const TelegramApi = require('node-telegram-bot-api');
const axios = require('axios');
const schedule = require('node-schedule');
const { gameOption, againOption } = require('./options.js');
// const { GoogleGenerativeAI } = require("@google/generative-ai");
const http = require('http');

// --- 1. ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ ---
const PORT = process.env.PORT || 3000;
const SERVER_URL = `https://assistbot-m7w5.onrender.com`; 
const token = process.env.TELEGRAM_TOKEN; 
const googleApiKey = process.env.GOOGLE_API_KEY; // Убедись, что в Render имя такое же!
const WHITE_LIST = [1204470331]; 

// --- 2. QA КОНТРОЛЬ: ПРОВЕРКА КЛЮЧА ПРИ ЗАПУСКЕ ---
console.log("--- СТАТУС ЗАПУСКА ---");
if (!googleApiKey) {
    console.error("❌ ОШИБКА: GOOGLE_API_KEY не найден в Environment!");
} else {
    console.log(`✅ Ключ Gemini подгружен. Длина: ${googleApiKey.length} символов.`);
}

// --- 3. ИНИЦИАЛИЗАЦИЯ GEMINI ---
// const genAI = new GoogleGenerativeAI(googleApiKey || "dummy_key");
// const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }, { apiVersion: 'v1' });

// --- 4. СЕРВЕР И САМОПИНГ ---
http.createServer((req, res) => res.end('Bot is running')).listen(PORT);

setInterval(async () => {
    try {
        await axios.get(SERVER_URL);
        console.log('Keep-alive: OK');
    } catch (e) {
        console.log('Keep-alive: FAIL (но бот работает)');
    }
}, 600000); // 10 минут

// --- 5. ФУНКЦИЯ GEMINI ---
// В начале файла убедись, что axios подключен
// const axios = require('axios');

async function getAIResponse(prompt) {
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${googleApiKey}`;        // ВАЖНО: Прямой API требует именно такую структуру contents
        const payload = {
            contents: [{
                parts: [{ text: prompt }]
            }]
        };

        console.log("--- Отправка запроса в Gemini ---");
        const response = await axios.post(url, payload);

        if (response.data.candidates && response.data.candidates[0].content) {
            return response.data.candidates[0].content.parts[0].text;
        } else {
            return "🤖 ИИ прислал пустой ответ.";
        }
    } catch (error) {
        // ЭТОТ БЛОК ПОКАЖЕТ РЕАЛЬНУЮ ПРИЧИНУ В ЛОГАХ
        if (error.response) {
            console.error("❌ Ошибка Gemini API:", JSON.stringify(error.response.data, null, 2));
        } else {
            console.error("❌ Ошибка Сети/Axios:", error.message);
        }
        return "🤖 Ошибка связи с Gemini. Посмотри логи в Render.";
    }
}

// --- 6. ОСНОВНОЙ БОТ ---
const bot = new TelegramApi(token, { polling: false });


const aiState = {};
const chats = {};

const startGame = async (chatId) => {
    const randomNumber = Math.floor(Math.random() * 10);
    chats[chatId] = randomNumber;
    await bot.sendMessage(chatId, `Я загадал число от 0 до 9. Угадай!`, gameOption);
};

const start = () => {
    bot.setMyCommands([
        { command: '/start', description: 'Запустить бота' },
        { command: '/info', description: 'Информация' },
        { command: '/ai', description: 'Режим ИИ' },
        { command: '/rates', description: 'Курс валют' },
        { command: '/remind', description: 'Напоминание' },
        { command: '/game', description: 'Сыграть в игру' }
    ]);

    bot.on('message', async msg => {
        const text = msg.text;
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        if (!text || !WHITE_LIST.includes(userId)) return;

        if (text === '/start') return bot.sendMessage(chatId, `Привет, Босс! Мы на Gemini.`);
        
        if (text === '/info') return bot.sendMessage(chatId, `Профиль: ${msg.from.first_name}\nID: ${userId}`);

        if (text === '/rates') {
            try {
                const res = await axios.get('https://api.exchangerate-api.com/v4/latest/USD');
                return bot.sendMessage(chatId, `📈 **1$:**\n🇰🇿 KZT: **${res.data.rates.KZT}**\n🇷🇺 RUB: **${res.data.rates.RUB}**`, { parse_mode: 'Markdown' });
            } catch (e) { return bot.sendMessage(chatId, "❌ Ошибка API"); }
        }

        if (text.startsWith('/remind')) {
            const args = text.split(' ');
            const mins = parseInt(args[1]);
            const task = args.slice(2).join(' ');
            if (isNaN(mins) || !task) return bot.sendMessage(chatId, "Используй: `/remind 10 Текст`", { parse_mode: 'Markdown' });

            bot.sendMessage(chatId, `✅ Ок, напомню через ${mins} мин.`);
            const date = new Date(Date.now() + mins * 60000);
            schedule.scheduleJob(date, () => {
                bot.sendMessage(chatId, `🔔 **НАПОМИНАНИЕ:**\n\n> ${task}`, { parse_mode: 'Markdown' });
            });
            return;
        }

        if (text === '/game') return startGame(chatId);

        if (text === '/ai') {
            aiState[chatId] = true;
            return bot.sendMessage(chatId, "🤖 Режим Gemini включен. Чтобы выйти, напиши 'Пока'.");
        }

        if (aiState[chatId] && !text.startsWith('/')) {
            if (['пока', 'стоп', 'stop', 'выход'].includes(text.toLowerCase().trim())) {
                aiState[chatId] = false;
                return bot.sendMessage(chatId, "🤖 Режим ИИ выключен.");
            }
            await bot.sendChatAction(chatId, 'typing');
            const aiAnswer = await getAIResponse(text);
            return bot.sendMessage(chatId, aiAnswer);
        }

        if (!text.startsWith('/')) return bot.sendMessage(chatId, "Команда не распознана.");
    });

    bot.on('callback_query', async msg => {
        const chatId = msg.message.chat.id;
        if (msg.data === '/again') return startGame(chatId);

        const userGuess = Number(msg.data);
        if (!isNaN(userGuess)) {
            const resultMsg = userGuess === chats[chatId] ? `🎉 Верно!` : `❌ Не угадал, было ${chats[chatId]}`;
            await bot.sendMessage(chatId, resultMsg, againOption);
            await bot.answerCallbackQuery(msg.id);
        }
    });
};
bot.deleteWebHook().then(() => {
    bot.startPolling();
    start();
    console.log("🚀 Бот запущен (Gemini Direct Mode)!");
}).catch(err => {
    console.error("Ошибка очистки Webhook:", err);
    start(); // Всё равно пробуем запуститься
});