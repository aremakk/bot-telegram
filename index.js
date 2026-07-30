require('dotenv').config();
const TelegramApi = require('node-telegram-bot-api');
const axios = require('axios');
const schedule = require('node-schedule');
const { gameOption, againOption } = require('./options.js');
// const { GoogleGenerativeAI } = require("@google/generative-ai");
const http = require('http');
const { encode } = require('punycode');

// --- 1. ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ ---
const PORT = process.env.PORT || 3005;
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

setInterval(() => {
    const used = process.memoryUsage().heapUsed / 1024 / 1024;
    console.log(`📊 RAM: ${Math.round(used * 100) / 100} MB`);
}, 3600000); // Раз в час проверяем, не "течет" ли память

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
    console.log(`🎲 ИГРА: Чат ${chatId} | Загадано число: ${randomNumber}`);
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

        console.log(chatId, userId, text);

        // if (!text || !WHITE_LIST.includes(userId)) return bot.sendMessage(chatId, "У тебя нет доступа к этому боту.");

        if (!text) return;

        const lowerText = text.toLowerCase().trim();
        console.log(`📩 [${msg.from.first_name}] ID: ${userId} -> ${text}`);

        // 1. Сначала проверяем системные команды (они должны работать всегда)
        if (text === '/start') {
            return bot.sendMessage(chatId, `Добро пожаловать в AssistBot ${msg.from.first_name}!`);
        }
        // if (text === '/start') return bot.sendMessage(chatId, `Покажи сиськи пожалуйста ${msg.from.first_name}🥺`);
        
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

        // 2. Управление режимом ИИ
        if (lowerText === 'привет') {
            aiState[chatId] = true;
            return bot.sendMessage(chatId, `Привет, Босс! Режим Gemini активирован. Спрашивай что угодно.`);
        }

        if (aiState[chatId] && ['пока', 'стоп', 'stop', 'выход'].includes(lowerText)) {
            aiState[chatId] = false;
            return bot.sendMessage(chatId, "🤖 Режим ИИ выключен.");
        }

        // 3. Логика работы ИИ (если режим включен и это не команда '/')
        if (aiState[chatId] && !text.startsWith('/')) {
            const triggerWords = ['нарисуй', 'сгенерируй', 'draw', 'generate', 'картинка'];
            const isImageRequest = triggerWords.some(word => lowerText.includes(word));
    
            if (isImageRequest) {
                let promptBase = text.replace(/сгенерируй|нарисуй|draw|generate|картинка/gi, '').trim();
                if (!promptBase) promptBase = "cute fluffy cat";
        
                await bot.sendChatAction(chatId, 'upload_photo');
                
                try {
                    const refinerPrompt = `High-quality photo of ${promptBase}, 8k, detailed. Max 20 words, English only.`;
                    let detailedPrompt = await getAIResponse(refinerPrompt);
                    detailedPrompt = detailedPrompt.replace(/["']/g, "").replace(/\n/g, " ").trim();
        
                    const seed = Math.floor(Math.random() * 1000000);
                    const query = encodeURIComponent(detailedPrompt);
                    const imageUrl = `https://pollinations.ai/p/${query}?width=1024&height=1024&seed=${seed}&model=flux&nologo=true`;
        
                    console.log(`🎨 Генерирую: ${imageUrl}`);
        
                    const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 20000 });
                    const buffer = Buffer.from(response.data, 'binary');
        
                    // Исправленная отправка:
                    return bot.sendPhoto(chatId, buffer, 
                        { 
                            caption: `🎨 **Готово!**\n\n**Запрос:** ${detailedPrompt}`,
                            parse_mode: 'Markdown'
                        }, 
                        { 
                            filename: 'cat.jpg', 
                            contentType: 'image/jpeg' 
                        }
                    );
        
                } catch (error) {
                    console.error("Ошибка генерации:", error.message);
                    return bot.sendMessage(chatId, "❌ Не удалось загрузить картинку. Попробуй еще раз через минуту.");
                }
            }

            // Обычный текст
            await bot.sendChatAction(chatId, 'typing');
            const aiAnswer = await getAIResponse(text);
            return bot.sendMessage(chatId, aiAnswer);
        }
    
        // 4. Если ничего не подошло
        if (!text.startsWith('/')) {
            return bot.sendMessage(chatId, "Команда не распознана. Напиши 'Привет', чтобы включить ИИ.");
        }
    });

    bot.on('callback_query', async msg => {
        const chatId = msg.message.chat.id;
        const firstName = msg.from.first_name;
        if (msg.data === '/again') return startGame(chatId);

        const userGuess = Number(msg.data);
        if (!isNaN(userGuess)) {
            const targetNumber = chats[chatId];
            console.log(`🎯 ВЫБОР: [${firstName}] нажал: ${userGuess} | Было загадано: ${targetNumber}`);
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