require('dotenv').config();
const TelegramApi = require('node-telegram-bot-api');
const axios = require('axios');
const schedule = require('node-schedule');
const { gameOption, againOption } = require('./options.js');
// const { GoogleGenerativeAI } = require("@google/generative-ai");
const http = require('http');
const { encode } = require('punycode');

// --- 1. ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ ---
const PORT = process.env.PORT || 3000;
const SERVER_URL = `https://assistbot-m7w5.onrender.com`; 
const token = process.env.TELEGRAM_TOKEN; 
const googleApiKey = process.env.GOOGLE_API_KEY; // Убедись, что в Render имя такое же!
const WHITE_LIST = [1204470331, 952165447]; 

// --- 2. QA КОНТРОЛЬ: ПРОВЕРКА КЛЮЧА ПРИ ЗАПУСКЕ ---
console.log("--- СТАТУС ЗАПУСКА ---");
if (!googleApiKey) {
    console.error("❌ ОШИБКА: GOOGLE_API_KEY не найден в Environment!");
} else {
    console.log(`✅ Ключ Gemini подгружен. Длина: ${googleApiKey.length} символов.`);
}

// --- 4. СЕРВЕР И САМОПИНГ ---
http.createServer((req, res) => res.end('Bot is running')).listen(PORT);

setInterval(async () => {
    try {
        await axios.get(SERVER_URL);
        console.log('Keep-alive: OK');
    } catch (e) {
        console.log('Keep-alive: FAIL (но бот работает)');
    }
}, 600000); 

// --- 5. ФУНКЦИЯ GEMINI ---
async function getAIResponse(prompt, retryCount = 0) {
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${googleApiKey}`;
        const response = await axios.post(url, {
            contents: [{ parts: [{ text: prompt }] }]
        });

        return response.data.candidates?.[0]?.content?.parts?.[0]?.text || "Пустой ответ";

    } catch (error) {
        if (error.response?.status === 503 && retryCount < 3) {
            console.log(`⏳ Сервер перегружен. Попытка #${retryCount + 1}...`);
            await new Promise(res => setTimeout(res, 3000)); // Ждем 3 секунды
            return getAIResponse(prompt, retryCount + 1); // Рекурсивный повтор
        }

        if (error.response?.status === 429) {
            return "⚠️ Слишком много запросов. Подожди минуту.";
        }

        console.error(error.response?.data || error.message);
        return "🤖 Ошибка AI.";
    }
}

async function generateImage(prompt){
    try{
        const query = encodeURIComponent(prompt);
        const imageUrl = `https://pollinations.ai/p/${query}?width=1024&height=1024&seed=${Math.floor(Math.random() * 1e6)}&model=flux`;
        return imageUrl;
    }catch(e){
        console.error("Ошибка генерации изображения:", e);
        return null;
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
        { command: '/rates', description: 'Курс валют' },
        { command: '/remind', description: 'Напоминание' },
        { command: '/game', description: 'Сыграть в игру' }
    ]);

    bot.on('message', async msg => {
        const text = msg.text;
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        if (!text || !WHITE_LIST.includes(userId)) return bot.sendMessage(chatId, "У тебя нет доступа к этому боту.");

        const lowerText = text.toLowerCase().trim();
        console.log(`📩 [${msg.from.first_name}] ID: ${userId} -> ${text}`);

        // Активация ИИ через Привет или /start
        if (lowerText === 'привет') {
            aiState[chatId] = true;
            return bot.sendMessage(chatId, `Привет, Босс! Режим Gemini активирован. Спрашивай что угодно.`);
        }

        if (aiState[chatId] && !text.startsWith('/')) {
            const triggerWords = ['нарисуй', 'сгенерируй', 'draw', 'generate', 'картинка'];
            const isImageRequest = triggerWords.some(word => lowerText.includes(word));
        
            if (isImageRequest) {
                await bot.sendChatAction(chatId, 'upload_photo');
                const imageUrl = await generateImage(text);
                if (imageUrl) {
                    return bot.sendPhoto(chatId, imageUrl, { 
                        caption: `🎨 Вот твой результат по запросу: "${text}"`,
                        reply_to_message_id: msg.message_id 
                    });
                } else {
                    return bot.sendMessage(chatId, "❌ Не удалось создать картинку.");
                }
            } else {
                await bot.sendChatAction(chatId, 'typing');
                const aiAnswer = await getAIResponse(text);
                return bot.sendMessage(chatId, aiAnswer);
            }
        }

        if (text === '/start') return bot.sendMessage(chatId, `Добро пожаловать в AssistBot ${msg.from.first_name}!`);

        // Выход из режима ИИ
        if (aiState[chatId] && ['пока', 'стоп', 'stop', 'выход'].includes(lowerText)) {
            aiState[chatId] = false;
            return bot.sendMessage(chatId, "🤖 Режим ИИ выключен.");
        }
        
        // Системные команды
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
            schedule.scheduleJob(new Date(Date.now() + mins * 60000), () => {
                bot.sendMessage(chatId, `🔔 **НАПОМИНАНИЕ:**\n\n> ${task}`, { parse_mode: 'Markdown' });
            });
            return;
        }

        if (text === '/game') return startGame(chatId);
        
        // Если режим ИИ включен — отправляем запрос
        if (aiState[chatId] && !text.startsWith('/')) {
            await bot.sendChatAction(chatId, 'typing');
            const aiAnswer = await getAIResponse(text);
            return bot.sendMessage(chatId, aiAnswer);
        }
    
        // Если режима ИИ нет и команда не распознана
        if (!text.startsWith('/')) {
            return bot.sendMessage(chatId, "Команда не распознана");
        }
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