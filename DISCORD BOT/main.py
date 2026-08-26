import os
import discord
from discord.ext import commands
from dotenv import load_dotenv
import logging
from database import init_db

# Configure logger
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s:%(levelname)s:%(name)s: %(message)s',
    handlers=[
        logging.FileHandler(filename='discord_bot.log', encoding='utf-8', mode='w'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger('WavelyBot')

# Load environment variables
load_dotenv()
TOKEN = os.getenv("DISCORD_TOKEN")
GUILD_ID = os.getenv("GUILD_ID")

if not TOKEN or TOKEN == "YOUR_BOT_TOKEN_HERE":
    logger.error("DISCORD_TOKEN is missing or is the default placeholder. Please edit the .env file.")

if not GUILD_ID:
    logger.warning("GUILD_ID is not set in .env. Commands will sync globally, which may take up to an hour.")
else:
    try:
        GUILD_ID = int(GUILD_ID)
    except ValueError:
        logger.error("GUILD_ID in .env must be an integer.")

# Initialize the SQLite database
logger.info("Initializing SQLite database...")
init_db()

# Setup bot intents
intents = discord.Intents.default()
intents.members = True          # Required for on_member_join (welcome DM) and verification role addition
intents.message_content = True  # Required for leveling XP additions and auto-moderation message content scanning
intents.guilds = True           # Required for channel/role manipulation
intents.messages = True         # Required for tracking messages
intents.invites = True          # Optional but useful for managing invites

# Initialize Bot class
class WavelyBot(commands.Bot):
    def __init__(self):
        super().__init__(command_prefix="w!", intents=intents, help_command=None)
        
    async def setup_hook(self):
        # Create cogs folder if it doesn't exist
        os.makedirs(os.path.join(os.path.dirname(__file__), "cogs"), exist_ok=True)
        
        # Load cogs
        cogs = [
            'cogs.welcome',
            'cogs.verification',
            'cogs.tickets',
            'cogs.automod',
            'cogs.antiraid',
            'cogs.leveling',
            'cogs.moderation',
            'cogs.utility'
        ]
        
        for cog in cogs:
            try:
                await self.load_extension(cog)
                logger.info(f"Successfully loaded extension: {cog}")
            except Exception as e:
                logger.error(f"Failed to load extension {cog}: {e}", exc_info=True)
                
        # Sync command tree
        if GUILD_ID:
            guild = discord.Object(id=GUILD_ID)
            self.tree.copy_global_to(guild=guild)
            try:
                await self.tree.sync(guild=guild)
                logger.info(f"Slash commands synchronized to guild: {GUILD_ID}")
            except discord.Forbidden:
                logger.warning(
                    f"⚠️ Missing Access (403 Forbidden) when syncing commands to guild ID {GUILD_ID}. "
                    "This usually means the bot has not yet joined this server, or was invited without the "
                    "'applications.commands' scope. Falling back to global sync..."
                )
                try:
                    await self.tree.sync()
                    logger.info("Slash commands synchronized globally as fallback.")
                except Exception as e:
                    logger.error(f"Failed to sync commands globally during fallback: {e}")
            except Exception as e:
                logger.error(f"Failed to sync commands to guild {GUILD_ID}: {e}")
        else:
            try:
                await self.tree.sync()
                logger.info("Slash commands synchronized globally.")
            except Exception as e:
                logger.error(f"Failed to sync commands globally: {e}")

bot = WavelyBot()

@bot.event
async def on_ready():
    logger.info(f"WavelyBot is online! Logged in as {bot.user} (ID: {bot.user.id})")
    # Set active status
    await bot.change_presence(
        activity=discord.Activity(
            type=discord.ActivityType.watching, 
            name="Wavely Server"
        ),
        status=discord.Status.online
    )

if __name__ == "__main__":
    if TOKEN and TOKEN != "YOUR_BOT_TOKEN_HERE":
        bot.run(TOKEN)
    else:
        print("[-] Bot cannot start. Set a valid DISCORD_TOKEN in the .env file.")
