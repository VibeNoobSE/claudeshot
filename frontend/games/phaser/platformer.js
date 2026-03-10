registerGame("platformer", "🏃 Platformer", "← → move, ↑ jump", "Race to collect all coins first", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#16213e");
    this.plats = this.physics.add.staticGroup();
    this.plats.add(this.add.rectangle(W/2, H-10, W, 20, 0x2a3a5e));
    [[150,400],[400,350],[650,300],[250,240],[500,190],[100,140],[650,100],[380,60]].forEach(([x,y])=>
      this.plats.add(this.add.rectangle(x,y,120,14,0x2a3a5e)));
    this.player = this.add.rectangle(100, H-40, 24, 32, 0xf7c948);
    this.physics.add.existing(this.player); this.player.body.setCollideWorldBounds(true).setGravityY(600);
    this.physics.add.collider(this.player, this.plats);
    this.coins = this.physics.add.group(); this.score = 0;
    for(let i=0;i<10;i++){const c=this.add.circle(Phaser.Math.Between(50,W-50),Phaser.Math.Between(30,H-80),8,0xe94560);this.coins.add(c);this.physics.add.existing(c,true);}
    this.physics.add.overlap(this.player, this.coins, (p,c) => { c.destroy(); this.scoreTxt.setText("Coins: "+(++this.score)+"/10");
      if(this.score>=10)this.add.text(W/2,H/2,"YOU WIN!",{fontSize:"48px",color:"#f7c948",fontFamily:"monospace"}).setOrigin(0.5);});
    this.scoreTxt = this.add.text(16,16,"Coins: 0/10",{fontSize:"18px",color:"#f7c948",fontFamily:"monospace"});
    this.cursors = this.input.keyboard.createCursorKeys();
  }
  update() {
    this.player.body.setVelocityX(this.cursors.left.isDown?-220:this.cursors.right.isDown?220:0);
    if(this.cursors.up.isDown&&this.player.body.touching.down) this.player.body.setVelocityY(-450);
  }
});
