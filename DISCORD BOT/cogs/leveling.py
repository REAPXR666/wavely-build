import discord
from discord import app_commands
from discord.ext import commands
import logging
import random
import database

logger = logging.getLogger('WavelyBot.Leveling')

class Leveling(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.Cog.listener()
    async def on_message(self, message):
        # Ignore bots, DMs, and bot command prefixes
        if message.author.bot or not message.guild:
            return
            
        # Ignore common bot prefixes to avoid rewarding command spam
        if message.content.startswith(('w!', '!', '?', '.', '$', '/')):
            return

        user_id = message.author.id
        guild_id = message.guild.id
        
        # Award random XP between 15 and 25
        xp_to_add = random.randint(15, 25)
        
        # Attempt to add XP (this function handles the 60-second cooldown internally)
        result = database.add_xp(user_id, guild_id, xp_to_add)
        
        if result is not None:
            leveled_up, new_level, new_xp = result
            if leveled_up:
                logger.info(f"User {message.author.name} ({user_id}) leveled up to {new_level}")
                await self.announce_level_up(message.author, message.channel, new_level)

    async def announce_level_up(self, member: discord.Member, channel: discord.TextChannel, level: int):
        embed = discord.Embed(
            title="🎉 Level Up!",
            description=f"Congratulations {member.mention}, you've reached **Level {level}**!",
            color=discord.Color.from_str("#7a22ff")
        )
        embed.set_footer(text="Keep active to rank up higher!")
        if member.avatar:
            embed.set_thumbnail(url=member.avatar.url)
            
        try:
            await channel.send(embed=embed)
        except Exception as e:
            logger.error(f"Failed to send level up announcement in {channel.name}: {e}")

    @app_commands.command(name="rank", description="Check your current level, XP, and global ranking.")
    @app_commands.describe(member="Select a user to view their rank (defaults to yourself)")
    async def rank(self, interaction: discord.Interaction, member: discord.Member = None):
        target = member or interaction.user
        
        # Fetch stats from database
        level, xp, rank, total_users = database.get_user_stats(target.id, interaction.guild.id)
        xp_needed = database.get_xp_needed(level)
        
        # Build progress bar
        # 10 blocks: ▰ represent filled, ▱ represent empty
        progress = xp / xp_needed if xp_needed > 0 else 0
        filled = min(10, max(0, int(progress * 10)))
        bar = "▰" * filled + "▱" * (10 - filled)
        percent = int(progress * 100)

        embed = discord.Embed(
            title=f"⭐ Rank Details - {target.display_name}",
            color=discord.Color.from_str("#7a22ff")
        )
        if target.avatar:
            embed.set_thumbnail(url=target.avatar.url)
            
        embed.add_field(name="Level", value=f"🏆 **{level}**", inline=True)
        embed.add_field(name="Rank", value=f"🥇 **#{rank or 'Unranked'}** / {total_users}", inline=True)
        embed.add_field(name="XP Progress", value=f"✨ `{xp:,} / {xp_needed:,}` ({percent}%)", inline=False)
        embed.add_field(name="Progress Bar", value=f"`{bar}`", inline=False)
        
        await interaction.response.send_message(embed=embed)

    @app_commands.command(name="leaderboard", description="Display the top 10 users with the highest level on Wavely.")
    async def leaderboard(self, interaction: discord.Interaction):
        # Fetch top users
        top_users = database.get_leaderboard(interaction.guild.id, limit=10)
        
        if not top_users:
            await interaction.response.send_message("ℹ️ No ranking data available for this server yet.", ephemeral=True)
            return

        embed = discord.Embed(
            title="🏆 Wavely Level Leaderboard",
            description="The most active members in our community!",
            color=discord.Color.from_str("#7a22ff")
        )
        
        if interaction.guild.icon:
            embed.set_thumbnail(url=interaction.guild.icon.url)

        leaderboard_content = []
        for index, entry in enumerate(top_users):
            user_id = entry['user_id']
            level = entry['level']
            xp = entry['xp']
            
            # Resolve user name
            member = interaction.guild.get_member(user_id)
            if member:
                name = member.display_name
            else:
                # Try to fetch from API if not cached
                try:
                    user = await self.bot.fetch_user(user_id)
                    name = user.name
                except:
                    name = f"User (ID: {user_id})"

            # Styling badges for top 3
            badge = "🥇" if index == 0 else "🥈" if index == 1 else "🥉" if index == 2 else f"`#{index+1}`"
            leaderboard_content.append(f"{badge} **{name}** - Level **{level}** (XP: `{xp}/{database.get_xp_needed(level)}`)")

        embed.description = "\n".join(leaderboard_content)
        embed.set_footer(text=f"Total Ranked Users: {len(leaderboard_content)}")
        await interaction.response.send_message(embed=embed)


    # Admin command group to manipulate levels (staff only)
    @app_commands.default_permissions(manage_guild=True)
    @app_commands.guild_only()
    class LevelAdminGroup(app_commands.Group, name="level", description="Commands for managing member levels."):
        
        @app_commands.command(name="set", description="Set a user's specific level and XP.")
        @app_commands.describe(member="Member to modify", level="New level", xp="New XP (default 0)")
        async def level_set(self, interaction: discord.Interaction, member: discord.Member, level: int, xp: int = 0):
            if level < 0 or xp < 0:
                await interaction.response.send_message("❌ Level and XP must be positive numbers.", ephemeral=True)
                return
                
            database.admin_set_level(member.id, interaction.guild.id, level, xp)
            await interaction.response.send_message(
                f"✅ Success! **{member.display_name}** has been set to Level **{level}** with `{xp}` XP.",
                ephemeral=False
            )
            logger.info(f"Mod {interaction.user.name} set level of {member.name} to {level} (XP: {xp})")

        @app_commands.command(name="add_xp", description="Give a user additional XP (instantly updates levels).")
        @app_commands.describe(member="Member to receive XP", amount="Amount of XP to add")
        async def level_add_xp(self, interaction: discord.Interaction, member: discord.Member, amount: int):
            if amount <= 0:
                await interaction.response.send_message("❌ XP amount must be greater than zero.", ephemeral=True)
                return

            leveled_up, new_level, new_xp = database.admin_add_xp(member.id, interaction.guild.id, amount)
            msg = f"✨ Added `{amount}` XP to **{member.display_name}**. They are now Level **{new_level}** (`{new_xp}` XP)."
            if leveled_up:
                msg += f"\n🎉 They leveled up!"
            await interaction.response.send_message(msg)
            logger.info(f"Mod {interaction.user.name} added {amount} XP to {member.name}")

        @app_commands.command(name="reset", description="Reset a user's leveling metrics to 0.")
        @app_commands.describe(member="Member to reset")
        async def level_reset(self, interaction: discord.Interaction, member: discord.Member):
            database.admin_reset_level(member.id, interaction.guild.id)
            await interaction.response.send_message(f"🔄 **{member.display_name}**'s level metrics have been reset to 0.")
            logger.info(f"Mod {interaction.user.name} reset level of {member.name}")

    # Instantiate and register the nested group
    def cog_load(self):
        # We add the group command to the cog's slash commands
        self.bot.tree.add_command(self.LevelAdminGroup())

async def setup(bot):
    await bot.add_cog(Leveling(bot))
