# Beeminder + Auth-free APIs Source Integration
Simple example data upload from auth-free API sources (currently supporting Project Euler, Clozemaster, CodeCombat) into new or existing Beeminder goal. Supports goal creation

## By Sergii Kalinchuk and Daniel Reeves

Short guidelines for those creating their own apps:

1) to make Beeminder recognize your app work, visit https://www.beeminder.com/apps/ and register your application properly
- create a nice name for it
- add authorized callback URL, such as https://yourapp.glitch.me/connect
- add deauthorization URL, such as https://yourapp.glitch.me/disconnect

2) fill in required parameters into .env file using env-sample as reference:
- input your Beeminder app ID into BEEMINDER_CLIENT_ID constant
- input your callback URL, registered in your Beeminder app, into AUTH_REDIRECT_URI constant
- fill in your nice app name into APP_NAME constant
- inform your app of your default source connection byt filling in DEFAULT_CONNECTION constant
- if your database connection require username and password, also write them into respective .env constants


3) Provide source connection parameters and data parsing function as one of the available connections inside settings.js file.

