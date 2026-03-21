require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  MessageFlags,
} = require("discord.js");

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

console.log("✅ BOT VERSION: Evidenta Actiuni v7");

function mustEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`❌ Missing environment variable: ${name}`);
    process.exit(1);
  }
  return v;
}

const TOKEN = mustEnv("TOKEN");
const CLIENT_ID = mustEnv("CLIENT_ID");
const GUILD_ID = mustEnv("GUILD_ID");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.GuildMember],
});

// actionMessageId -> state
const actions = new Map();

function makeFrequency() {
  const a = Math.floor(Math.random() * 900) + 100;
  const b = Math.floor(Math.random() * 900) + 100;
  return `${a}.${b}`;
}

function makeTwoDifferentFrequencies() {
  const f1 = makeFrequency();
  let f2 = makeFrequency();
  while (f2 === f1) {
    f2 = makeFrequency();
  }
  return [f1, f2];
}

function formatAbsentUser(member) {
  return `<@${member.user.id}>`;
}

function formatPresentUserOpen(userId, startUnix) {
  return `<@${userId}> — <t:${startUnix}:t>`;
}

function formatPresentUserClosed(userId, startUnix, endUnix) {
  return `<@${userId}> — <t:${startUnix}:t> → <t:${endUnix}:t>`;
}

function uniqueSorted(arr) {
  return Array.from(new Set(arr)).sort((a, b) => a.localeCompare(b, "ro"));
}

function buildActionMessage(state) {
  const prezenti = uniqueSorted(state.prezenti);
  const absenti = uniqueSorted(state.absenti);

  const prezentiText = prezenti.length > 0 ? prezenti.join("\n") : "-";
  const absentiText = absenti.length > 0 ? absenti.join("\n") : "-";
  const mentiuniText = state.mentiuni?.trim() ? state.mentiuni.trim() : "-";

  const closedText = state.closedAt
    ? `\n**Acțiunea s-a închis la:** <t:${state.closedAt}:f>\n`
    : "";

  const content =
`**\`${state.createdByName}\`:**
**Se organizează acțiune de tip:** ${state.titlu}

**Detalii despre acțiune:**
**Locație:** ${state.locatie}
**Data/Ora:** ${state.dataOra}
**Frecvență:** \`${state.freq1}\`
**Back-up:** \`${state.freq2}\`

**Mențiuni acțiune:**
${mentiuniText}${closedText}
**Total membri:** ${state.total}
**Confirmați:** ${prezenti.length}
**Absenți:** ${absenti.length}

✅ **Prezenți**
${prezentiText}

❌ **Absenți**
${absentiText}

Apasă pe ✅ pentru a confirma prezența. Dacă pleci mai devreme, apasă pe „Părăsește acțiunea”.`;

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`actiune_confirm_${state.id}`)
      .setLabel("Confirmă prezența")
      .setStyle(ButtonStyle.Success)
      .setDisabled(state.closed),
    new ButtonBuilder()
      .setCustomId(`actiune_leave_${state.id}`)
      .setLabel("Părăsește acțiunea")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(state.closed),
    new ButtonBuilder()
      .setCustomId(`actiune_close_${state.id}`)
      .setLabel("Închide acțiunea")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(state.closed)
  );

  return { content, components: [buttons] };
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("actiune")
      .setDescription("Creează o nouă evidență de acțiune.")
      .addStringOption((option) =>
        option
          .setName("titlu")
          .setDescription("Tipul acțiunii (patrula/farm/jaf/etc...)")
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("data_ora")
          .setDescription("Data și ora într-un singur câmp")
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("locatie")
          .setDescription("Locația acțiunii")
          .setRequired(true)
      )
      .addRoleOption((option) =>
        option
          .setName("rol1")
          .setDescription("Primul rol participant")
          .setRequired(true)
      )
      .addRoleOption((option) =>
        option
          .setName("rol2")
          .setDescription("Al doilea rol participant (opțional)")
          .setRequired(false)
      )
      .addRoleOption((option) =>
        option
          .setName("rol3")
          .setDescription("Al treilea rol participant (opțional)")
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName("mentiuni")
          .setDescription("Detalii suplimentare")
          .setRequired(false)
      )
      .toJSON(),
  ];

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log("✅ Slash commands registered.");
}

client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  try {
    const res = await pool.query("SELECT NOW()");
    console.log("🟢 DB connected:", res.rows[0]);
  } catch (err) {
    console.error("🔴 DB connection failed:", err);
  }

  await registerCommands();
});

client.login(TOKEN);
