registerGame("invaders", "👾 Invaders", "← → move, SPACE shoot", "Co-op defense or score race", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#0a0a1e");
    this.ship=this.add.rectangle(W/2,H-30,40,16,0x4ecca3); this.physics.add.existing(this.ship); this.ship.body.setCollideWorldBounds(true);
    this.invaders=this.physics.add.group(); const colors=[0xe94560,0xf7c948,0xaf7ac5,0x5dade2];
    for(let r=0;r<4;r++)for(let c=0;c<10;c++){const inv=this.add.rectangle(120+c*58,50+r*40,36,20,colors[r]);this.invaders.add(inv);this.physics.add.existing(inv);}
    this.invDir=1;this.invTick=0; this.bullets=this.physics.add.group(); this.score=0;
    this.scoreTxt=this.add.text(16,16,"Score: 0",{fontSize:"18px",color:"#4ecca3",fontFamily:"monospace"});
    this.physics.add.overlap(this.bullets,this.invaders,(b,inv)=>{b.destroy();inv.destroy();this.scoreTxt.setText("Score: "+(this.score+=10));
      if(this.invaders.countActive()===0)this.add.text(W/2,H/2,"VICTORY!",{fontSize:"48px",color:"#4ecca3",fontFamily:"monospace"}).setOrigin(0.5);});
    this.cursors=this.input.keyboard.createCursorKeys(); this.space=this.input.keyboard.addKey("SPACE"); this.lastShot=0;
  }
  update(t) {
    this.ship.body.setVelocityX(this.cursors.left.isDown?-300:this.cursors.right.isDown?300:0);
    if(this.space.isDown&&t>this.lastShot+300){this.lastShot=t;const b=this.add.rectangle(this.ship.x,this.ship.y-16,4,12,0x4ecca3);this.bullets.add(b);this.physics.add.existing(b);b.body.setVelocityY(-400);this.time.delayedCall(2000,()=>b.destroy());}
    if(++this.invTick%30===0){let edge=false;this.invaders.getChildren().forEach(i=>{if(i.active){i.x+=this.invDir*16;if(i.x>W-30||i.x<30)edge=true;}});
      if(edge){this.invDir*=-1;this.invaders.getChildren().forEach(i=>{if(i.active)i.y+=20;});}}
  }
});
