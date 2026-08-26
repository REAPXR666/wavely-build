import discord
from discord.ext import commands
import logging
import re
import time
import database
from datetime import timedelta

logger = logging.getLogger('WavelyBot.AutoMod')

# Compile regex for discord invites
INVITE_REGEX = re.compile(
    r'(discord\.(gg|io|me|li)\/.+|discord(app)?\.com\/invite\/.+)', 
    re.IGNORECASE
)

# Profanity list (standard bad words / slurs)
PROFANITY_LIST = {
    "nigger", "nigga", "faggot", "retard", "kike", "tranny", "chink", "cunt", 
    "kys", "kill yourself", "rape"
}

class AutoMod(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        # Key: (guild_id, user_id), Value: list of floats (timestamps of messages)
        self.message_logs = {}
        # Cooldown to prevent spamming warnings for a single spam block
        self.warning_cooldown = {}

    @commands.Cog.listener()
    async def on_message(self, message):
        # Ignore bots and direct messages
        if message.author.bot or not message.guild:
            return

        # Bypass moderation check for administrators or moderators (who have manage_messages)
        if message.author.guild_permissions.manage_messages or message.author.guild_permissions.administrator:
            return

        user_id = message.author.id
        guild_id = message.guild.id
        content = message.content

        # 1. Invite Link Filtering
        if INVITE_REGEX.search(content):
            await self.handle_violation(
                message, 
                reason="Posting Discord invite links", 
                warn_db=True
            )
            return

        # 2. Profanity Filtering
        # Normalize text: lowercase and remove extra characters/spaces
        normalized_content = re.sub(r'[^a-zA-Z\s]', '', content.lower())
        words = set(normalized_content.split())
        
        # Check for direct word matches or substring matches for phrases like "kill yourself"
        has_profanity = False
        violated_word = ""
        for bad_word in PROFANITY_LIST:
            if bad_word in words or bad_word in content.lower():
                has_profanity = True
                violated_word = bad_word
                break

        if has_profanity:
            await self.handle_violation(
                message, 
                reason=f"Profanity/Slurs filter triggered", 
                warn_db=True
            )
            return

        # 3. Excessive Mentions
        # Count user mentions (excluding roles and @everyone)
        mention_count = len(message.mentions)
        if mention_count >= 5:
            await self.handle_violation(
                message, 
                reason=f"Mass mentions ({mention_count} users)", 
                warn_db=True
            )
            return

        # 4. Spam Detection (5 messages within 3 seconds)
        current_time = time.time()
        tracker_key = (guild_id, user_id)
        
        if tracker_key not in self.message_logs:
            self.message_logs[tracker_key] = []
            
        # Log the current message timestamp
        self.message_logs[tracker_key].append(current_time)
        
        # Clean up timestamps older than 3 seconds
        self.message_logs[tracker_key] = [
            t for t in self.message_logs[tracker_key] if current_time - t <= 3.0
        ]
        
        if len(self.message_logs[tracker_key]) >= 5:
            # Clear logs to avoid double trigger
            self.message_logs[tracker_key].clear()
            
            # Spam detected! Send violation, apply warning, and timeout user for 5 minutes
            await self.handle_violation(
                message, 
                reason="Chat spamming (5 messages in 3s)", 
                warn_db=True,
                timeout_duration=300 # 5 minutes
            )
            return

    async def handle_violation(self, message, reason, warn_db=True, timeout_duration=0):
        user = message.author
        guild = message.guild
        channel = message.channel

        # Delete message first to stop exposure
        try:
            await message.delete()
        except discord.NotFound:
            pass
        except discord.Forbidden:
            logger.error(f"Cannot delete message for {user.name} - Forbidden.")

        # Rate limit bot warnings to same channel
        cooldown_key = (guild.id, user.id, reason)
        current_time = time.time()
        if cooldown_key in self.warning_cooldown and current_time - self.warning_cooldown[cooldown_key] < 5.0:
            return
        self.warning_cooldown[cooldown_key] = current_time

        # Database Warning log
        warning_info = ""
        if warn_db:
            warnings_count = database.add_warning(
                user_id=user.id,
                guild_id=guild.id,
                moderator_id=self.bot.user.id,
                reason=f"[Auto-Mod] {reason}"
            )
            warning_info = f" (Warning #{warnings_count})"
            logger.info(f"AutoMod warned {user.name} ({user.id}) for: {reason}. Total warning count: {warnings_count}")

        # Timeout handling
        timeout_info = ""
        if timeout_duration > 0:
            try:
                await user.timeout(
                    timedelta(seconds=timeout_duration), 
                    reason=f"[Auto-Mod] {reason}"
                )
                timeout_info = "\nYou have been placed in timeout for 5 minutes."
                logger.info(f"AutoMod timed out {user.name} for {timeout_duration}s.")
            except discord.Forbidden:
                logger.error(f"Cannot timeout {user.name} - permissions issue.")
            except Exception as e:
                logger.error(f"Error timing out {user.name}: {e}")

        # Send public warning that self-deletes
        warn_embed = discord.Embed(
            title="⚠️ Auto-Moderation Alert",
            description=(
                f"{user.mention}, your message has been deleted.\n"
                f"**Reason:** {reason}.{warning_info}{timeout_info}\n\n"
                "Please follow the server guidelines and keep chat clean!"
            ),
            color=discord.Color.orange()
        )
        try:
            warning_msg = await channel.send(embed=warn_embed)
            # Delete message after 8 seconds
            await warning_msg.delete(delay=8.0)
        except Exception as e:
            logger.error(f"Could not send/delete auto-mod warn message: {e}")

        # Send DM warning
        try:
            dm_embed = discord.Embed(
                title=f"⚠️ Warning from {guild.name}",
                description=(
                    f"You have received an automatic warning for: **{reason}**.\n"
                    f"Continued violations of server rules will result in a timeout, kick, or ban.{timeout_info}"
                ),
                color=discord.Color.red()
            )
            await user.send(embed=dm_embed)
        except discord.Forbidden:
            pass # DM blocked

async def setup(bot):
    await bot.add_cog(AutoMod(bot))
